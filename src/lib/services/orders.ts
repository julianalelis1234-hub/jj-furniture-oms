import type { DataStore, OrderPatch, SpecInput } from "@/lib/data/store";
import { formatDate } from "@/lib/domain/dates";
import { DomainError } from "@/lib/domain/errors";
import { formatPeso } from "@/lib/domain/finance";
import { generatePin, hashPin } from "@/lib/domain/pin";
import { assertTransition, rolesAllowedFor } from "@/lib/domain/status";
import type {
  Actor,
  ConfirmationMethod,
  Order,
  OrderStatus,
  PaymentExceptionType,
  PriorityLabel,
} from "@/lib/domain/types";
import { editOrderSchema, newOrderSchema, specRevisionSchema, type NewOrderInput } from "@/lib/domain/validation";
import { describeDiff, dimensionsText, itemNameFor, normalizeSpec, type Dims, type SpecDiff } from "@/lib/domain/furniture";
import { nextDraftCode, nextOrderCode } from "./codes";
import { ensureRole } from "./guard";
import { notifyCustomer } from "./notify";

const trackUrl = () => `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/track`;

export async function mustGetOrder(store: DataStore, id: string): Promise<Order> {
  const o = await store.getOrder(id);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  return o;
}

// ------------------------------------------------------------- create ------
export async function createOrder(store: DataStore, actor: Actor, raw: unknown) {
  ensureRole(actor, ["owner", "staff"], "encode new orders");
  const parsed = newOrderSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const input: NewOrderInput = parsed.data;

  const existing = await store.listOrders();
  if (existing.some((o) => o.paper_slip_number.toLowerCase() === input.paper_slip_number.toLowerCase())) {
    throw new DomainError("DUPLICATE_SLIP", `Paper slip #${input.paper_slip_number} is already encoded.`);
  }
  const spec = normalizeSpec({
    furniture_category: input.furniture_category,
    design_variant: input.design_variant,
    width_cm: input.width_cm,
    height_cm: input.height_cm,
    depth_cm: input.depth_cm,
    wood_type: input.wood_type,
    custom_wood_note: input.custom_wood_note || null,
    color_finish: input.color_finish,
    quantity: input.quantity,
  });
  const pin = generatePin();
  const order = await store.insertOrder({
    order_code: nextDraftCode(existing),
    paper_slip_number: input.paper_slip_number,
    encoded_by_id: input.encoded_by_id,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
    delivery_address: input.delivery_address,
    municipality: input.municipality,
    pin_code_hash: hashPin(pin),
    pin_code_display: pin,
    item_name: input.item_name || itemNameFor(spec),
    quantity: spec.quantity,
    dimensions: dimensionsText(spec as Dims),
    wood_type: spec.wood_type,
    color_finish: spec.color_finish,
    furniture_category: spec.furniture_category,
    design_variant: spec.design_variant,
    width_cm: spec.width_cm,
    height_cm: spec.height_cm,
    depth_cm: spec.depth_cm,
    custom_wood_note: spec.custom_wood_note,
    special_instructions: input.special_instructions || null,
    reference_photo_url: input.reference_photo_url || null,
    specs_confirmed: false,
    status: "Waiting for Confirmation",
    priority_rank: 99,
    priority_label: "Normal",
    assigned_craftsman_id: null,
    furniture_price: input.furniture_price,
    delivery_fee: input.delivery_fee,
    payment_exception_type: input.payment_exception_type,
    payment_exception_approved: false,
    estimated_completion_date: input.estimated_completion_date,
    scheduled_delivery_date: input.scheduled_delivery_date || null,
  });
  // revision 1: the staff draft quote the customer will confirm
  await store.addSpecRevision({
    order_id: order.id,
    type: "staff_draft",
    spec: { ...spec, quoted_furniture_price: input.furniture_price, quoted_delivery_fee: input.delivery_fee },
    expected_revision: null,
    created_by_role: actor.role,
    created_by_id: actor.id,
  });
  await store.insertHistory({
    order_id: order.id,
    from_status: null,
    to_status: order.status,
    changed_by_id: actor.id,
    notes: `Encoded from paper slip #${order.paper_slip_number} · specification revision 1`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  return { order: await mustGetOrder(store, order.id), pin };
}

// ------------------------------------------------------- confirmation ------
/**
 * Records the customer's explicit confirmation of ONE exact revision. The
 * revision number is what the confirmer was shown; if the specification has
 * changed since, the confirmation is rejected (never authorizes a stale spec).
 */
export async function recordConfirmation(
  store: DataStore,
  actor: Actor | null,
  input: { order_id: string; confirmation_method: ConfirmationMethod; confirmed_by_name: string; revision_number: number },
) {
  if (actor) ensureRole(actor, ["owner", "staff"], "record customer confirmations");
  if (actor && input.confirmation_method === "Customer Portal PIN")
    throw new DomainError("FORBIDDEN", "Only the customer can confirm through the PIN portal.");
  if (!actor && input.confirmation_method !== "Customer Portal PIN") throw new DomainError("FORBIDDEN", "Not allowed.");

  const order = await mustGetOrder(store, input.order_id);
  if (order.status !== "Waiting for Confirmation") throw new DomainError("INVALID_TRANSITION", "Order is not waiting for confirmation.");
  const newCode = order.order_code.startsWith("DR-")
    ? nextOrderCode(await store.listOrders(), Number(new Date().getFullYear()), order.order_code)
    : null;
  await store.confirmSpecRevision({
    order_id: order.id,
    revision_number: input.revision_number,
    method: input.confirmation_method,
    confirmed_by_name: input.confirmed_by_name,
    recorded_by: actor?.id ?? null,
    new_order_code: newCode,
  });
  const confirmed = await mustGetOrder(store, order.id);
  await store.insertHistory({
    order_id: order.id,
    from_status: order.status,
    to_status: "Confirmed",
    changed_by_id: actor?.id ?? null,
    notes: `Specification revision ${input.revision_number} confirmed via ${input.confirmation_method}${newCode ? `; order ID ${order.order_code} → ${newCode}` : ""}`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  await notifyCustomer(
    store,
    confirmed,
    `JJ Furniture: Specs for ${confirmed.order_code} (${confirmed.item_name}) are confirmed. 30% down payment: ${formatPeso(
      confirmed.standard_down_payment_due,
    )}. Est. completion ${formatDate(confirmed.estimated_completion_date)}. Track at ${trackUrl()} using the PIN on your slip.`,
  );
  return confirmed;
}

/** Staff/owner issue a new revised quote (spec + price). Voids any previous approval. */
export async function reviseSpecs(store: DataStore, actor: Actor, orderId: string, raw: unknown, expectedRevision: number | null) {
  ensureRole(actor, ["owner", "staff"], "revise specifications");
  const parsed = specRevisionSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const order = await mustGetOrder(store, orderId);
  const v = parsed.data;
  const spec = normalizeSpec({ ...v, custom_wood_note: v.custom_wood_note || null });
  const res = await store.addSpecRevision({
    order_id: orderId,
    type: "revised_quote",
    spec: { ...spec, quoted_furniture_price: v.furniture_price, quoted_delivery_fee: v.delivery_fee },
    expected_revision: expectedRevision,
    created_by_role: actor.role,
    created_by_id: actor.id,
  });
  await store.insertHistory({
    order_id: orderId,
    from_status: order.status,
    to_status: "Waiting for Confirmation",
    changed_by_id: actor.id,
    notes: `Revised quote issued as specification revision ${res.revision_number}${
      Object.keys(res.changed_fields).length ? ` (${describeDiff(res.changed_fields as SpecDiff)})` : ""
    } — customer must confirm again`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  return mustGetOrder(store, orderId);
}

export async function editOrderDetails(store: DataStore, actor: Actor, orderId: string, raw: unknown) {
  ensureRole(actor, ["owner", "staff"], "edit order details");
  const parsed = editOrderSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const order = await mustGetOrder(store, orderId);
  const v = parsed.data;
  if (v.municipality !== "Valencia City" && v.delivery_fee <= 0)
    throw new DomainError("VALIDATION", "Enter the distance-based delivery fee for deliveries outside Valencia City.");
  const newFee = v.municipality === "Valencia City" ? 0 : v.delivery_fee;
  const feeChanged = newFee !== order.delivery_fee;
  if (feeChanged && order.status !== "Waiting for Confirmation")
    throw new DomainError("SPEC_LOCKED", "The delivery fee is part of the confirmed quote. Use a change request to adjust it.");
  const res = await store.updateOrder(
    orderId,
    {
      customer_phone: v.customer_phone,
      delivery_address: v.delivery_address,
      municipality: v.municipality,
      delivery_fee: v.delivery_fee,
      special_instructions: v.special_instructions || null,
      reference_photo_url: v.reference_photo_url || null,
      estimated_completion_date: v.estimated_completion_date,
      scheduled_delivery_date: v.scheduled_delivery_date || null,
    },
    order.version,
  );
  if (!res.ok) throw new DomainError("VERSION_CONFLICT", "This order was changed by someone else. Please refresh.");
  // A fee change is a new quote: record it as a revision the customer must confirm.
  if (feeChanged && !res.order.is_legacy_incomplete && res.order.furniture_category) {
    const o = res.order;
    await store.addSpecRevision({
      order_id: o.id,
      type: "revised_quote",
      spec: {
        furniture_category: o.furniture_category, design_variant: o.design_variant, width_cm: o.width_cm, height_cm: o.height_cm,
        depth_cm: o.depth_cm, wood_type: o.wood_type, custom_wood_note: o.custom_wood_note, color_finish: o.color_finish,
        quantity: o.quantity, quoted_furniture_price: o.furniture_price, quoted_delivery_fee: o.delivery_fee,
      } as SpecInput,
      expected_revision: o.current_revision,
      created_by_role: actor.role,
      created_by_id: actor.id,
    });
    return mustGetOrder(store, o.id);
  }
  return res.order;
}

export async function setPaymentTerms(store: DataStore, actor: Actor, orderId: string, type: PaymentExceptionType) {
  ensureRole(actor, ["owner", "staff"], "change payment terms");
  const order = await mustGetOrder(store, orderId);
  const res = await store.updateOrder(
    orderId,
    { payment_exception_type: type, payment_exception_approved: actor.role === "owner" && type !== "Standard 30/70" },
    order.version,
  );
  if (!res.ok) throw new DomainError("VERSION_CONFLICT", "This order was changed by someone else. Please refresh.");
  return res.order;
}

// -------------------------------------------------------- transitions ------
export interface TransitionOptions {
  notes?: string;
  expectedVersion?: number;
  clientTransactionId?: string;
}

const CUSTOMER_MESSAGES: Partial<Record<OrderStatus, (o: Order) => string>> = {
  "In Production": (o) => `JJ Furniture: Your ${o.item_name} (${o.order_code}) is now In Production. Est. completion ${formatDate(o.estimated_completion_date)}.`,
  "Ready for Delivery": (o) =>
    `JJ Furniture: ${o.order_code} passed quality inspection and is Ready for Delivery. Delivery date: ${formatDate(o.scheduled_delivery_date)}.`,
  "Out for Delivery": (o) =>
    `JJ Furniture: Your ${o.item_name} (${o.order_code}) is out for delivery today. Amount to prepare: ${formatPeso(o.collectible_on_delivery)}.`,
  Delivered: (o) => `JJ Furniture: ${o.order_code} delivered. Salamat! Report any scratch or repair need at ${trackUrl()}.`,
};

export async function transitionOrder(store: DataStore, actor: Actor, orderId: string, to: OrderStatus, opts: TransitionOptions = {}) {
  // Craftsmen cannot update the orders table under RLS; their workflow runs elevated after this check.
  const writer = actor.role === "craftsman" ? store.elevated() : store;
  const order = await mustGetOrder(writer, orderId);
  const allowed = rolesAllowedFor(order.status, to);
  if (order.status !== to && !allowed.includes(actor.role)) {
    throw new DomainError(
      order.status === "Completed / For Inspection" ? "OWNER_ONLY" : "FORBIDDEN",
      `A ${actor.role} cannot move an order from "${order.status}" to "${to}".`,
    );
  }
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== order.version) {
    throw new DomainError("VERSION_CONFLICT", "This order was changed by someone else. Please refresh.", order);
  }
  assertTransition(order, to, await writer.listPayments(orderId));

  const patch: OrderPatch = { status: to };
  if (actor.role === "craftsman" && to === "In Production" && !order.assigned_craftsman_id) patch.assigned_craftsman_id = actor.id;
  const res = await writer.updateOrder(orderId, patch, opts.expectedVersion ?? order.version);
  if (!res.ok) throw new DomainError("VERSION_CONFLICT", "This order was changed by someone else. Please refresh.", res.current);

  await store.insertHistory({
    order_id: orderId,
    from_status: order.status,
    to_status: to,
    changed_by_id: actor.id,
    notes: opts.notes?.trim() || null,
    client_transaction_id: opts.clientTransactionId ?? null,
    changed_at: new Date().toISOString(),
  });
  const msg = CUSTOMER_MESSAGES[to];
  if (msg && order.status !== to) await notifyCustomer(store, res.order, msg(res.order));
  return res.order;
}

export async function passInspection(store: DataStore, actor: Actor, orderId: string, notes?: string) {
  ensureRole(actor, ["owner"], "pass inspections");
  return transitionOrder(store, actor, orderId, "Ready for Delivery", { notes: notes || "Inspection passed" });
}

export async function failInspection(store: DataStore, actor: Actor, orderId: string, notes: string) {
  ensureRole(actor, ["owner"], "fail inspections");
  if (!notes?.trim()) throw new DomainError("VALIDATION", "Describe what must be fixed so the craftsman knows.");
  return transitionOrder(store, actor, orderId, "In Production", { notes: `Inspection failed: ${notes.trim()}` });
}

// ----------------------------------------------------------- priority ------
const QUEUE_STATUSES: OrderStatus[] = ["Confirmed", "In Production", "Completed / For Inspection"];

export function productionQueue(orders: Order[]): Order[] {
  return orders
    .filter((o) => QUEUE_STATUSES.includes(o.status))
    .sort((a, b) => a.priority_rank - b.priority_rank || a.estimated_completion_date.localeCompare(b.estimated_completion_date));
}

/** Moves an order up/down the owner's queue and renumbers ranks 1..n. */
export async function moveInQueue(store: DataStore, actor: Actor, orderId: string, direction: "up" | "down") {
  ensureRole(actor, ["owner"], "reorder production priority");
  const queue = productionQueue(await store.listOrders());
  const i = queue.findIndex((o) => o.id === orderId);
  if (i < 0) throw new DomainError("NOT_FOUND", "Order is not in the production queue.");
  const j = direction === "up" ? i - 1 : i + 1;
  if (j >= 0 && j < queue.length) [queue[i], queue[j]] = [queue[j], queue[i]];
  for (const [idx, o] of queue.entries()) {
    if (o.priority_rank !== idx + 1) {
      const res = await store.updateOrder(o.id, { priority_rank: idx + 1 });
      if (!res.ok) throw new DomainError("VERSION_CONFLICT", "Queue changed. Please refresh.");
    }
  }
  return productionQueue(await store.listOrders());
}

export async function setPriorityLabel(store: DataStore, actor: Actor, orderId: string, label: PriorityLabel) {
  ensureRole(actor, ["owner"], "set production priority");
  const order = await mustGetOrder(store, orderId);
  const patch: OrderPatch = { priority_label: label };
  if (label === "Urgent") {
    // urgent jobs jump to the top of the queue
    const top = productionQueue(await store.listOrders()).filter((o) => o.id !== orderId);
    patch.priority_rank = 1;
    for (const [idx, o] of top.entries()) if (o.priority_rank !== idx + 2) await store.updateOrder(o.id, { priority_rank: idx + 2 });
  } else if (order.priority_rank === 99) {
    patch.priority_rank = productionQueue(await store.listOrders()).filter((o) => o.priority_rank !== 99).length + 1;
  }
  const res = await store.updateOrder(orderId, patch);
  if (!res.ok) throw new DomainError("VERSION_CONFLICT", "Order changed. Please refresh.");
  return res.order;
}
