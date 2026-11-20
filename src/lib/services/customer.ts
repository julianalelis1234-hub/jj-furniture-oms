import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import { furniturePaidFrom, feePaidFrom } from "@/lib/domain/finance";
import type { CustomerTrack, OrderStatus } from "@/lib/domain/types";
import { recordConfirmation } from "./orders";

/** Order-ID-only lookup — stage and the two dates, nothing else. */
export async function trackOrder(publicStore: DataStore, code: string): Promise<CustomerTrack | null> {
  const clean = code.trim().toUpperCase();
  if (!/^(JJ-\d{4}-\d{4}|DR-\d{4})$/.test(clean)) return null;
  return publicStore.customerTrack(clean);
}

export interface CustomerOrderView {
  order_code: string;
  customer_name: string;
  item_name: string;
  quantity: number;
  dimensions: string;
  wood_type: string;
  color_finish: string;
  special_instructions: string | null;
  status: OrderStatus;
  specs_confirmed: boolean;
  estimated_completion_date: string;
  scheduled_delivery_date: string | null;
  delivery_address: string;
  municipality: string;
  payment: {
    furniture_price: number;
    standard_down_payment_due: number;
    furniture_paid: number;
    remaining_furniture_balance: number;
    delivery_fee: number;
    delivery_fee_paid: number;
    collectible_on_delivery: number;
    terms: string;
  };
  timeline: { to_status: string; changed_at: string }[];
  open_repairs: { description: string; status: string; created_at: string }[];
}

/**
 * Full view for one order, only after PIN verification (the caller passes the
 * order id taken from a verified, signed customer token).
 */
export async function customerOrderView(publicStore: DataStore, orderId: string): Promise<CustomerOrderView> {
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  const [payments, history, exceptions] = await Promise.all([
    store.listPayments(orderId),
    store.listHistory(orderId),
    store.listExceptions(orderId),
  ]);
  return {
    order_code: o.order_code,
    customer_name: o.customer_name,
    item_name: o.item_name,
    quantity: o.quantity,
    dimensions: o.dimensions,
    wood_type: o.wood_type,
    color_finish: o.color_finish,
    special_instructions: o.special_instructions,
    status: o.status,
    specs_confirmed: o.specs_confirmed,
    estimated_completion_date: o.estimated_completion_date,
    scheduled_delivery_date: o.scheduled_delivery_date,
    delivery_address: o.delivery_address,
    municipality: o.municipality,
    payment: {
      furniture_price: o.furniture_price,
      standard_down_payment_due: o.standard_down_payment_due,
      furniture_paid: furniturePaidFrom(payments),
      remaining_furniture_balance: o.remaining_furniture_balance,
      delivery_fee: o.delivery_fee,
      delivery_fee_paid: feePaidFrom(payments),
      collectible_on_delivery: o.collectible_on_delivery,
      terms: o.payment_exception_type,
    },
    timeline: history
      .filter((h) => h.from_status !== h.to_status)
      .map((h) => ({ to_status: h.to_status, changed_at: h.changed_at }))
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at)),
    open_repairs: exceptions
      .filter((e) => e.category === "On-Site Scratch Touch-Up / Repair")
      .map((e) => ({ description: e.description, status: e.status, created_at: e.created_at })),
  };
}

export async function customerConfirmSpecs(publicStore: DataStore, orderId: string) {
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  return recordConfirmation(store, null, {
    order_id: orderId,
    confirmation_method: "Customer Portal PIN",
    confirmed_by_name: o.customer_name,
  });
}

export async function customerRequestRepair(publicStore: DataStore, orderId: string, description: string) {
  const text = description.trim();
  if (text.length < 5) throw new DomainError("VALIDATION", "Please describe the scratch or repair needed.");
  if (text.length > 1000) throw new DomainError("VALIDATION", "Please keep it under 1,000 characters.");
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  const open = (await store.listExceptions(orderId)).filter(
    (e) => e.category === "On-Site Scratch Touch-Up / Repair" && e.status === "Pending" && e.requested_by === "Customer (portal)",
  );
  if (open.length >= 3) throw new DomainError("RATE_LIMITED", "You already have open repair requests. The shop will contact you.");
  return store.insertException({
    order_id: orderId,
    category: "On-Site Scratch Touch-Up / Repair",
    description: text,
    requested_by: "Customer (portal)",
    status: "Pending",
    resolved_by_id: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  });
}
