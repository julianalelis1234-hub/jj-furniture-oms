import type { DataStore } from "@/lib/data/store";
import { formatDate } from "@/lib/domain/dates";
import { DomainError } from "@/lib/domain/errors";
import { downPaymentShortfall, formatPeso, money, splitDeliveryCollection } from "@/lib/domain/finance";
import type { Actor, DeliveryAssignment, Order, PaymentMethod } from "@/lib/domain/types";
import { deliveryScheduleSchema } from "@/lib/domain/validation";
import { deriveUuid, ensureRole } from "./guard";
import { notifyCustomer } from "./notify";
import { mustGetOrder, transitionOrder } from "./orders";

export async function scheduleDelivery(store: DataStore, actor: Actor, raw: unknown) {
  ensureRole(actor, ["owner", "staff"], "schedule deliveries");
  const parsed = deliveryScheduleSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const v = parsed.data;
  const order = await mustGetOrder(store, v.order_id);
  if (order.status !== "Ready for Delivery")
    throw new DomainError("INVALID_TRANSITION", "Only orders that passed inspection (Ready for Delivery) can be scheduled.");
  const driver = (await store.listProfiles()).find((p) => p.id === v.driver_id && p.role === "driver" && p.is_active);
  if (!driver) throw new DomainError("VALIDATION", "Choose an active delivery driver.");

  const delivery = await store.insertDelivery({
    order_id: order.id,
    driver_id: driver.id,
    vehicle_type: v.vehicle_type,
    scheduled_date: v.scheduled_date,
    time_window: v.time_window,
    delivery_fee: order.delivery_fee,
    expected_collectible_amount: order.collectible_on_delivery,
    dispatch_status: "Scheduled",
    failure_or_damage_notes: null,
    updated_at: new Date().toISOString(),
  });
  const res = await store.updateOrder(order.id, { scheduled_delivery_date: v.scheduled_date });
  if (!res.ok) throw new DomainError("VERSION_CONFLICT", "Order changed. Please refresh.");

  // Exception gate: dispatch with < 30% down payment needs the owner.
  const shortfall = downPaymentShortfall(order, await store.listPayments(order.id));
  if (shortfall > 0 && !order.payment_exception_approved) {
    const pending = (await store.listExceptions(order.id)).some(
      (e) => e.status === "Pending" && (e.category === "Credit / Unpaid Balance" || e.category === "Installment Approval"),
    );
    if (!pending) {
      await store.insertException({
        order_id: order.id,
        category: "Credit / Unpaid Balance",
        description: `Scheduled for dispatch with ${formatPeso(shortfall)} of the 30% down payment unpaid. Owner approval needed before the trip.`,
        requested_by: actor.full_name,
        status: "Pending",
        is_production_blocking: false,
        resolved_by_id: null,
        created_at: new Date().toISOString(),
        resolved_at: null,
      });
    }
  }
  await notifyCustomer(
    store,
    res.order,
    `JJ Enterprises: ${order.order_code} is scheduled for delivery on ${formatDate(v.scheduled_date)}, ${v.time_window} (${v.vehicle_type}). Amount to prepare: ${formatPeso(order.collectible_on_delivery)}.`,
  );
  return delivery;
}

// ============================================================================
// Driver actions — identical code path for online clicks and offline replays.
// ============================================================================
export type DriverActionType = "start_trip" | "delivered" | "failed";

export interface DriverAction {
  client_transaction_id: string;
  type: DriverActionType;
  delivery_id: string;
  order_id: string;
  base_version: number;
  queued_at: string;
  amount_collected?: number;
  payment_method?: PaymentMethod;
  notes?: string;
  needs_touch_up?: boolean;
}

export type DriverActionResult =
  | { status: "applied" | "duplicate"; client_transaction_id: string; order_version: number; order_status: Order["status"] }
  | { status: "conflict"; client_transaction_id: string; message: string; current: { version: number; status: Order["status"]; collectible_on_delivery: number } }
  /** gone: the delivery or its order no longer exists for this rider (cancelled or removed by the shop) */
  | { status: "rejected"; client_transaction_id: string; message: string; gone?: boolean };

const TARGET: Record<DriverActionType, Order["status"]> = {
  start_trip: "Out for Delivery",
  delivered: "Delivered",
  failed: "Ready for Delivery",
};
const SOURCE: Record<DriverActionType, Order["status"]> = {
  start_trip: "Ready for Delivery",
  delivered: "Out for Delivery",
  failed: "Out for Delivery",
};

/**
 * Applies one queued driver action.
 *  - Idempotent: the client_transaction_id is written to order_status_history
 *    (and to payments); replays return "duplicate" without side effects.
 *  - Optimistic concurrency: base_version must match the order's version,
 *    otherwise a conflict is returned for the driver to review — never a
 *    silent overwrite of a staff member's change.
 */
export async function applyDriverAction(store: DataStore, actor: Actor, action: DriverAction): Promise<DriverActionResult> {
  ensureRole(actor, ["driver"], "record delivery actions");
  const txn = action.client_transaction_id;

  const already = await store.findHistoryByTransaction(txn);
  if (already) {
    const o = await mustGetOrder(store, action.order_id);
    return { status: "duplicate", client_transaction_id: txn, order_version: o.version, order_status: o.status };
  }

  const delivery = (await store.listDeliveries({ driverId: actor.id })).find((d) => d.id === action.delivery_id);
  if (!delivery || delivery.order_id !== action.order_id)
    return { status: "rejected", client_transaction_id: txn, message: "This delivery is not assigned to you.", gone: true };

  const order = await store.getOrder(action.order_id);
  if (!order) return { status: "rejected", client_transaction_id: txn, message: "Order not found.", gone: true };

  // A previous attempt of this same action may have stored its payment before failing;
  // that payment bumped the version, so it is our own change, not a conflict.
  const ownPartial = (await store.listPayments(order.id)).some((p) => p.client_transaction_id === txn);
  if (order.version !== action.base_version && !ownPartial) {
    return {
      status: "conflict",
      client_transaction_id: txn,
      message:
        order.status === TARGET[action.type]
          ? `Order is already "${order.status}" (changed by someone else while you were offline).`
          : `The shop updated this order while you were offline (now "${order.status}"). Review before re-applying.`,
      current: { version: order.version, status: order.status, collectible_on_delivery: order.collectible_on_delivery },
    };
  }

  const notesPrefix = `[${action.type === "start_trip" ? "Trip started" : action.type === "delivered" ? "Delivered" : "Failed delivery"}${
    action.queued_at ? ` · recorded ${new Date(action.queued_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}` : ""
  }]`;

  try {
    if (action.type === "failed" && order.status === "Ready for Delivery") {
      // Never left the shop: only the assignment changes.
      await failAssignment(store, actor, delivery, order, action);
      await store.insertHistory({
        order_id: order.id, from_status: order.status, to_status: order.status, changed_by_id: actor.id,
        notes: `${notesPrefix} ${action.notes ?? ""}`.trim(), client_transaction_id: txn, changed_at: new Date().toISOString(),
      });
      const o = await mustGetOrder(store, order.id);
      return { status: "applied", client_transaction_id: txn, order_version: o.version, order_status: o.status };
    }
    if (order.status !== SOURCE[action.type]) {
      return { status: "rejected", client_transaction_id: txn, message: `Order is "${order.status}", expected "${SOURCE[action.type]}".` };
    }

    if (action.type === "delivered") {
      const amount = money(Math.max(0, action.amount_collected ?? 0));
      if (amount > 0 && !ownPartial) {
        const { toBalance, toFee } = splitDeliveryCollection(order, amount);
        const method = action.payment_method ?? "Cash";
        if (toBalance > 0)
          await store.insertPayment({
            order_id: order.id, client_transaction_id: txn, payment_type: "Delivery Balance Collection", amount: toBalance,
            payment_method: method, collected_by_id: actor.id, verified_by_owner_or_staff: false,
            notes: "Collected on delivery — awaiting handover verification", paid_at: action.queued_at || new Date().toISOString(),
          });
        if (toFee > 0)
          await store.insertPayment({
            order_id: order.id, client_transaction_id: await deriveUuid(txn, "fee"), payment_type: "Delivery Fee", amount: toFee,
            payment_method: method, collected_by_id: actor.id, verified_by_owner_or_staff: false,
            notes: "Delivery fee collected — awaiting handover verification", paid_at: action.queued_at || new Date().toISOString(),
          });
      }
      const shortBy = money(order.collectible_on_delivery - amount);
      if (shortBy > 0 && !ownPartial) {
        // system-generated owner approval (drivers may only file touch-ups under RLS)
        await store.elevated().insertException({
          order_id: order.id, category: "Credit / Unpaid Balance",
          description: `Delivered with ${formatPeso(shortBy)} not collected (collected ${formatPeso(amount)} of ${formatPeso(order.collectible_on_delivery)}). ${action.notes ?? ""}`.trim(),
          requested_by: actor.full_name, status: "Pending", is_production_blocking: false, resolved_by_id: null, created_at: new Date().toISOString(), resolved_at: null,
        });
      }
    }

    const fresh = await mustGetOrder(store, order.id); // payments may have bumped the version
    const updated = await transitionOrder(store, actor, order.id, TARGET[action.type], {
      notes: `${notesPrefix} ${action.notes ?? ""}${action.type === "delivered" ? ` · cash collected ${formatPeso(action.amount_collected ?? 0)}` : ""}`.trim(),
      expectedVersion: fresh.version,
      clientTransactionId: txn,
    });

    if (action.type === "start_trip") await store.updateDelivery(delivery.id, { dispatch_status: "Out for Delivery" });
    if (action.type === "delivered") await store.updateDelivery(delivery.id, { dispatch_status: "Delivered" });
    if (action.type === "failed") await failAssignment(store, actor, delivery, updated, action);

    const final = await mustGetOrder(store, order.id);
    return { status: "applied", client_transaction_id: txn, order_version: final.version, order_status: final.status };
  } catch (e) {
    if (e instanceof DomainError) return { status: "rejected", client_transaction_id: txn, message: e.message };
    throw e;
  }
}

async function failAssignment(store: DataStore, actor: Actor, delivery: DeliveryAssignment, order: Order, action: DriverAction) {
  await store.updateDelivery(delivery.id, {
    dispatch_status: "Failed / Reschedule",
    failure_or_damage_notes: action.notes?.trim() || "Failed delivery (no details given)",
  });
  if (action.needs_touch_up) {
    await store.insertException({
      order_id: order.id, category: "On-Site Scratch Touch-Up / Repair",
      description: action.notes?.trim() || "Touch-up needed after failed delivery", requested_by: actor.full_name,
      status: "Pending",
      is_production_blocking: false, resolved_by_id: null, created_at: new Date().toISOString(), resolved_at: null,
    });
  }
}

/** Data a driver pre-loads before leaving the shop (stored in IndexedDB). */
export async function driverManifest(store: DataStore, actor: Actor) {
  ensureRole(actor, ["driver"], "load delivery assignments");
  const deliveries = await store.listDeliveries({ driverId: actor.id });
  const orders = await Promise.all(deliveries.map((d) => store.getOrder(d.order_id)));
  return deliveries
    .map((d, i) => {
      const o = orders[i];
      if (!o) return null;
      return {
        delivery: d,
        order: {
          id: o.id, order_code: o.order_code, version: o.version, status: o.status, customer_name: o.customer_name,
          customer_phone: o.customer_phone, delivery_address: o.delivery_address, municipality: o.municipality,
          item_name: o.item_name, quantity: o.quantity, dimensions: o.dimensions, color_finish: o.color_finish,
          collectible_on_delivery: o.collectible_on_delivery, delivery_fee: o.delivery_fee,
          remaining_furniture_balance: o.remaining_furniture_balance, payment_exception_type: o.payment_exception_type,
          payment_exception_approved: o.payment_exception_approved, special_instructions: o.special_instructions,
          payment_plan: o.payment_plan, installment_count: o.installment_count ?? null,
          down_payment_ok: o.payment_exception_approved || (o.furniture_price ?? 0) - o.remaining_furniture_balance >= o.standard_down_payment_due,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
export type ManifestEntry = Awaited<ReturnType<typeof driverManifest>>[number];
