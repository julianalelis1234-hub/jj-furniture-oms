import { MemoryStore } from "@/lib/data/memory-store";
import { buildFixtureTables, STAFF } from "@/lib/data/seed";
import { addDays, todayISO } from "@/lib/domain/dates";
import type { Actor } from "@/lib/domain/types";

export async function seededStore() {
  return new MemoryStore(await buildFixtureTables());
}

export const actors = {
  owner: { id: STAFF.owner, role: "owner", full_name: "Mr. Vincris Lelis", source: "demo" },
  staff: { id: STAFF.gilbert, role: "staff", full_name: "Gilbert Decena", source: "demo" },
  craftsman: { id: STAFF.nolito, role: "craftsman", full_name: "Nolito Remulta", source: "demo" },
  driver: { id: STAFF.jesse, role: "driver", full_name: "Jesse Decena", source: "demo" },
  otherDriver: { id: STAFF.rey, role: "driver", full_name: "Rey", source: "demo" },
} satisfies Record<string, Actor>;

export function validOrderInput(overrides: Record<string, unknown> = {}) {
  const today = todayISO();
  return {
    paper_slip_number: `T-${Math.random().toString(36).slice(2, 8)}`,
    encoded_by_id: STAFF.gilbert,
    customer_name: "Juan Dela Cruz",
    customer_phone: "0900 000 0201",
    customer_email: "Juan.DelaCruz@Example.com ", // normalized on save
    has_no_email: "",
    delivery_address: "Purok 3, Brgy. Poblacion, near the church",
    municipality: "Valencia City",
    item_name: "",
    quantity: "1",
    furniture_category: "Dining Table",
    design_variant: "4-Seater Rectangular",
    width_cm: "120",
    height_cm: "76",
    depth_cm: "80",
    wood_type: "Mahogany",
    custom_wood_note: "",
    color_finish: "Walnut Stain",
    special_instructions: "",
    reference_photo_url: "",
    furniture_price: "10000",
    delivery_fee: "0",
    payment_exception_type: "Standard 30/70",
    estimated_completion_date: addDays(today, 7),
    scheduled_delivery_date: "",
    ...overrides,
  };
}

import type { DataStore } from "@/lib/data/store";
import { customerAcceptQuote } from "@/lib/services/customer";
import { recordConfirmation, transitionOrder } from "@/lib/services/orders";
import { standardDownPayment } from "@/lib/domain/finance";

/** Quote of a given revision as shown to the person accepting it. */
async function quoteOf(store: DataStore, orderId: string, revisionNumber?: number) {
  const o = (await store.getOrder(orderId))!;
  const n = revisionNumber ?? o.current_revision;
  const rev = (await store.listRevisions(orderId)).find((r) => r.revision_number === n)!;
  return { n, rev };
}

/** The shop confirms the submitted order (Waiting for Confirmation -> Confirmed), straight on the store. */
export async function shopConfirm(store: DataStore, orderId: string) {
  const o = (await store.getOrder(orderId))!;
  if (o.status !== "Waiting for Confirmation") return o;
  return transitionOrder(store, actors.staff, orderId, "Confirmed", { notes: "Order confirmed by the shop" });
}

/** The shop issues the quotation of a Confirmed order (a revised_quote with the current spec and price). */
export async function issueQuotation(store: DataStore, orderId: string, price?: number) {
  const o = (await store.getOrder(orderId))!;
  const rev = (await store.listRevisions(orderId)).find((r) => r.revision_number === o.current_revision)!;
  return store.addSpecRevision({
    order_id: orderId, type: "revised_quote", expected_revision: o.current_revision, created_by_role: "staff", created_by_id: null,
    spec: {
      furniture_category: rev.furniture_category!, design_variant: rev.design_variant!, width_cm: rev.width_cm!, height_cm: rev.height_cm!,
      depth_cm: rev.depth_cm!, wood_type: rev.wood_type, custom_wood_note: rev.custom_wood_note, color_finish: rev.color_finish, quantity: rev.quantity,
      quoted_furniture_price: price ?? rev.quoted_furniture_price ?? o.furniture_price ?? 10000, quoted_delivery_fee: rev.quoted_delivery_fee ?? o.delivery_fee,
    },
    paper_slip_number: o.paper_slip_number ?? `S-${o.order_code}`,
    estimated_completion_date: o.estimated_completion_date ?? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
  });
}

/**
 * Migration 009: acceptance needs a Confirmed order with an issued quotation.
 * Brings a submitted order there (confirm + issue) unless it already is.
 */
export async function readyForAcceptance(store: DataStore, orderId: string) {
  await shopConfirm(store, orderId);
  const o = (await store.getOrder(orderId))!;
  const latest = (await store.listRevisions(orderId)).find((r) => r.revision_number === o.current_revision);
  if (o.status === "Confirmed" && (!o.quotation_issued_at || latest?.revision_type === "customer_proposal")) await issueQuotation(store, orderId);
}

/** Customer presses [Accept Quote & Confirm Specifications] on revision n (default: latest). */
export async function customerAccept(store: DataStore, orderId: string, revisionNumber?: number, key = crypto.randomUUID()) {
  if (revisionNumber === undefined) await readyForAcceptance(store, orderId);
  const { n, rev } = await quoteOf(store, orderId, revisionNumber);
  return customerAcceptQuote(store, orderId, {
    revision_id: rev.revision_id,
    expected_revision_number: n,
    accepted_furniture_price: rev.quoted_furniture_price ?? 0,
    accepted_delivery_fee: rev.quoted_delivery_fee ?? 0,
    client_idempotency_key: key,
    accept_specification: true,
    accept_quotation: true,
  });
}

/** Staff record an in-store / Messenger acceptance of revision n (default: latest). */
export async function staffAccept(store: DataStore, actor: Actor, orderId: string, method: "Signed Paper Slip" | "Messenger Reply" | "Customer Portal PIN" = "Signed Paper Slip", revisionNumber?: number) {
  if (revisionNumber === undefined) await readyForAcceptance(store, orderId);
  const { n, rev } = await quoteOf(store, orderId, revisionNumber);
  return recordConfirmation(store, actor, {
    order_id: orderId,
    confirmation_method: method,
    confirmed_by_name: "Juan Dela Cruz",
    revision_number: n,
    accepted_furniture_price: rev.quoted_furniture_price ?? 0,
    accepted_delivery_fee: rev.quoted_delivery_fee ?? 0,
    client_idempotency_key: crypto.randomUUID(),
  });
}

/** Logs a verified 30% down payment so Confirmed -> In Production can pass. */
export async function payDown(store: DataStore, orderId: string, amount?: number) {
  const o = (await store.getOrder(orderId))!;
  await store.insertPayment({
    order_id: orderId, client_transaction_id: crypto.randomUUID(), payment_type: "Down Payment (30%)",
    amount: amount ?? standardDownPayment(o.furniture_price ?? 0), payment_method: "Cash", collected_by_id: null,
    verified_by_owner_or_staff: true, notes: null, paid_at: new Date().toISOString(),
  });
}
