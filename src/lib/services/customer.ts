import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import { furniturePaidFrom, feePaidFrom } from "@/lib/domain/finance";
import type { CustomerTrack, OrderStatus, SpecRevision } from "@/lib/domain/types";
import { recordConfirmation } from "./orders";
import { describeDiff, normalizeSpec, type FurnitureSpec, type SpecDiff } from "@/lib/domain/furniture";
import { customerProposalSchema } from "@/lib/domain/validation";

/** Order-ID-only lookup — stage and the two dates, nothing else. */
export async function trackOrder(publicStore: DataStore, code: string): Promise<CustomerTrack | null> {
  const clean = code.trim().toUpperCase();
  if (!/^(JJ-\d{4}-\d{4}|DR-\d{4})$/.test(clean)) return null;
  return publicStore.customerTrack(clean);
}

/** Spec shown to the customer: one immutable revision. */
export interface CustomerSpecView {
  revision_number: number;
  revision_type: SpecRevision["revision_type"];
  spec: FurnitureSpec;
  legacy_dimensions_text: string | null;
  quoted_furniture_price: number;
  quoted_delivery_fee: number;
}

export type SpecState =
  | "awaiting_confirmation" // latest revision is a shop quote; customer may confirm or propose changes
  | "proposal_under_review" // customer's proposal waits for the shop's revised quote
  | "needs_shop_review" // other open review items (e.g. owner approval) must be resolved first
  | "legacy_needs_spec" // pre-configurator order: shop must issue a structured quote
  | "locked"; // confirmed for workshop production (read-only)

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
  /** the latest saved revision (current_revision) — what the customer reviews */
  current: CustomerSpecView | null;
  /** the shop's latest quote (authoritative order spec) */
  quote: CustomerSpecView | null;
  approved_revision_number: number | null;
  spec_state: SpecState;
  revisions: { revision_number: number; revision_type: string; created_at: string; changes: string }[];
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
  open_repairs: { description: string; status: string; created_at: string; category: string }[];
}

const toSpecView = (r: SpecRevision): CustomerSpecView => ({
  revision_number: r.revision_number,
  revision_type: r.revision_type,
  spec: {
    furniture_category: r.furniture_category,
    design_variant: r.design_variant,
    width_cm: r.width_cm,
    height_cm: r.height_cm,
    depth_cm: r.depth_cm,
    wood_type: r.wood_type,
    custom_wood_note: r.custom_wood_note,
    color_finish: r.color_finish,
    quantity: r.quantity,
  },
  legacy_dimensions_text: r.legacy_dimensions_text,
  quoted_furniture_price: r.quoted_furniture_price,
  quoted_delivery_fee: r.quoted_delivery_fee,
});

/**
 * Full view for one order, only after PIN verification (the caller passes the
 * order id taken from a verified, signed customer token).
 */
export async function customerOrderView(publicStore: DataStore, orderId: string): Promise<CustomerOrderView> {
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  const [payments, history, exceptions, revisions] = await Promise.all([
    store.listPayments(orderId),
    store.listHistory(orderId),
    store.listExceptions(orderId),
    store.listRevisions(orderId),
  ]);
  const current = revisions.find((r) => r.revision_number === o.current_revision) ?? null;
  const quote = [...revisions].reverse().find((r) => r.revision_type !== "customer_proposal") ?? null;
  const pending = exceptions.filter((e) => e.status === "Pending");
  const spec_state: SpecState =
    o.status !== "Waiting for Confirmation"
      ? "locked"
      : current?.revision_type === "customer_proposal"
        ? "proposal_under_review"
        : o.is_legacy_incomplete
          ? "legacy_needs_spec"
          : pending.length > 0
            ? "needs_shop_review"
            : "awaiting_confirmation";
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
    current: current ? toSpecView(current) : null,
    quote: quote ? toSpecView(quote) : null,
    approved_revision_number: o.approved_revision_number,
    spec_state,
    revisions: revisions.map((r) => ({
      revision_number: r.revision_number,
      revision_type: r.revision_type,
      created_at: r.created_at,
      changes: "backfill" in r.changed_fields ? "Original order" : describeDiff(r.changed_fields as SpecDiff),
    })),
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
      .filter((e) => e.requested_by === "Customer (portal)" || e.category === "On-Site Scratch Touch-Up / Repair")
      .map((e) => ({ description: e.description, status: e.status, created_at: e.created_at, category: e.category })),
  };
}

/** Scenario 1 — the customer confirms the exact revision they were shown. */
export async function customerConfirmSpecs(publicStore: DataStore, orderId: string, revisionNumber: number) {
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  return recordConfirmation(store, null, {
    order_id: orderId,
    confirmation_method: "Customer Portal PIN",
    confirmed_by_name: o.customer_name,
    revision_number: revisionNumber,
  });
}

export const CUSTOMER_PROPOSAL_PREFIX = "Customer proposed specification changes";

/**
 * Scenario 2 — the customer proposes changes. Saved as a new immutable
 * customer_proposal revision; a Pending review item is raised; nothing is
 * approved and production stays locked until the shop quotes and the customer
 * confirms that quote.
 */
export async function customerProposeChanges(publicStore: DataStore, orderId: string, seenRevision: number, raw: unknown) {
  const parsed = customerProposalSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please check the highlighted fields.", parsed.error);
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  const spec = normalizeSpec({ ...parsed.data, custom_wood_note: parsed.data.custom_wood_note || null });
  const res = await store.addSpecRevision({
    order_id: orderId,
    type: "customer_proposal",
    spec,
    expected_revision: seenRevision,
    created_by_role: "customer",
    created_by_id: null,
  });
  const changes = describeDiff(res.changed_fields as SpecDiff);
  await store.insertException({
    order_id: orderId,
    category: "Spec Clarification",
    description: `${CUSTOMER_PROPOSAL_PREFIX} (revision ${res.revision_number}): ${changes}. Review price/delivery impact and send a revised quote.`,
    requested_by: "Customer (portal)",
    status: "Pending",
    resolved_by_id: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  });
  // in-app alert for the shop (appears in the order's update log and Needs Your Attention)
  await store.insertNotification({
    order_id: orderId,
    recipient_phone: null,
    channel: "In-App",
    message_body: `Staff/Owner: ${o.customer_name} proposed specification changes for ${o.order_code} — ${changes}`,
    delivery_status: "Sent",
    created_at: new Date().toISOString(),
  });
  await store.insertHistory({
    order_id: orderId,
    from_status: o.status,
    to_status: o.status,
    changed_by_id: null,
    notes: `Customer proposal saved as specification revision ${res.revision_number}: ${changes}`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  return res;
}

/** After confirmation: change requests and repairs go to the shop for approval. */
export async function customerRequestRepair(
  publicStore: DataStore,
  orderId: string,
  description: string,
  kind: "change" | "repair" = "repair",
) {
  const text = description.trim();
  if (text.length < 5) throw new DomainError("VALIDATION", "Please describe what you need.");
  if (text.length > 1000) throw new DomainError("VALIDATION", "Please keep it under 1,000 characters.");
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  if (o.status === "Waiting for Confirmation")
    throw new DomainError("VALIDATION", "Your order is not confirmed yet — edit the specifications above instead.");
  const open = (await store.listExceptions(orderId)).filter((e) => e.status === "Pending" && e.requested_by === "Customer (portal)");
  if (open.length >= 3) throw new DomainError("RATE_LIMITED", "You already have open requests. The shop will contact you.");
  return store.insertException({
    order_id: orderId,
    category: kind === "change" ? "Spec Clarification" : "On-Site Scratch Touch-Up / Repair",
    description: kind === "change" ? `Post-confirmation change request: ${text}` : text,
    requested_by: "Customer (portal)",
    status: "Pending",
    resolved_by_id: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  });
}
