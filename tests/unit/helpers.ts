import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeedTables, STAFF } from "@/lib/data/seed";
import { addDays, todayISO } from "@/lib/domain/dates";
import type { Actor } from "@/lib/domain/types";

export async function seededStore() {
  return new MemoryStore(await buildSeedTables());
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
import { recordConfirmation } from "@/lib/services/orders";
import { standardDownPayment } from "@/lib/domain/finance";

/** Quote of a given revision as shown to the person accepting it. */
async function quoteOf(store: DataStore, orderId: string, revisionNumber?: number) {
  const o = (await store.getOrder(orderId))!;
  const n = revisionNumber ?? o.current_revision;
  const rev = (await store.listRevisions(orderId)).find((r) => r.revision_number === n)!;
  return { n, rev };
}

/** Customer presses [Accept Quote & Confirm Specifications] on revision n (default: latest). */
export async function customerAccept(store: DataStore, orderId: string, revisionNumber?: number, key = crypto.randomUUID()) {
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
