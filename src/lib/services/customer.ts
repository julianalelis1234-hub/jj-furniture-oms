import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import { effectiveDeliveryFee, furniturePaidFrom, feePaidFrom } from "@/lib/domain/finance";
import { blockingItems, isQuoteExpired } from "@/lib/domain/gate";
import { QUOTE_REVISION_TYPES, type Order, type OrderStatus, type Payment, type PaymentMethod, type PaymentPlan, type SpecRevision } from "@/lib/domain/types";
import { recordConfirmation } from "./orders";
import { checkRoomPhoto, type ProofStore } from "./payments";
import { nextOrderCode } from "./codes";
import { describeDiff, dimensionsText, itemNameFor, normalizeSpec, type Dims, type FurnitureSpec, type SpecDiff } from "@/lib/domain/furniture";
import { customerProposalSchema, customerRequestSchema } from "@/lib/domain/validation";

/** Spec shown to the customer: one immutable revision. */
export interface CustomerSpecView {
  revision_id: string;
  revision_number: number;
  revision_type: SpecRevision["revision_type"];
  spec: FurnitureSpec;
  legacy_dimensions_text: string | null;
  quoted_furniture_price: number | null;
  quoted_delivery_fee: number | null;
  /** quotation validity (shop quotes only) */
  quoted_at: string | null;
  expires_at: string | null;
}

/** Where the order is in submit -> confirm -> quotation -> accept + pay (migration 009). */
export type SpecState =
  | "submitted" // waiting for the shop to confirm the order (legacy Quote Requested too)
  | "awaiting_quotation" // confirmed; the shop is preparing the official quotation
  | "awaiting_acceptance" // quotation issued; the customer may accept it (and choose terms) or propose changes
  | "quote_expired" // the issued quotation expired; the shop must issue a fresh one
  | "proposal_under_review" // the customer's proposal waits for the shop's revised quotation
  | "needs_shop_review" // other open review items must be resolved first
  | "legacy_needs_spec" // pre-configurator order: shop must issue a structured quote
  | "accepted" // quotation accepted: pay the down payment, production follows
  | "locked"; // in production or later: specification is locked (read-only)

/** A payment as the customer sees it (their own order only). */
export interface CustomerPaymentView {
  id: string;
  amount: number;
  payment_type: Payment["payment_type"];
  payment_method: PaymentMethod;
  reference_number: string | null;
  paid_at: string;
  state: "pending" | "verified" | "rejected";
  rejection_reason: string | null;
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
  order_origin: Order["order_origin"];
  estimated_completion_date: string | null;
  scheduled_delivery_date: string | null;
  delivery_address: string;
  municipality: string;
  /** the latest saved revision (current_revision) — what the customer reviews */
  current: CustomerSpecView | null;
  /** the shop's latest quote (authoritative order spec) */
  quote: CustomerSpecView | null;
  approved_revision_number: number | null;
  spec_state: SpecState;
  confirmed_at: string | null;
  quotation_issued_at: string | null;
  payment_plan: PaymentPlan | null;
  preferred_payment_method: PaymentMethod | null;
  payments: CustomerPaymentView[];
  revisions: { revision_number: number; revision_type: string; created_at: string; changes: string }[];
  payment: {
    furniture_price: number | null;
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
  revision_id: r.revision_id,
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
  quoted_at: r.quoted_at,
  expires_at: r.expires_at,
});

/**
 * Full customer-facing view for one order. Callers pass an order id whose
 * ownership was already established: the signed-in customer's own order
 * (customer_user_id = auth.uid(), checked by the server and by RLS) or the
 * single order of a consumed review link.
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
  const quote = [...revisions].reverse().find((r) => QUOTE_REVISION_TYPES.includes(r.revision_type)) ?? null;
  const spec_state: SpecState =
    o.status === "Quote Requested" || o.status === "Waiting for Confirmation"
      ? "submitted"
      : o.status !== "Confirmed"
        ? "locked"
        : o.specs_confirmed
          ? "accepted"
          : current?.revision_type === "customer_proposal"
            ? "proposal_under_review"
            : !o.quotation_issued_at
              ? "awaiting_quotation"
              : o.is_legacy_incomplete
                ? "legacy_needs_spec"
                : blockingItems(o.id, exceptions).length > 0
                  ? "needs_shop_review"
                  : current && isQuoteExpired(current)
                    ? "quote_expired"
                    : "awaiting_acceptance";
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
    order_origin: o.order_origin,
    estimated_completion_date: o.estimated_completion_date,
    scheduled_delivery_date: o.scheduled_delivery_date,
    delivery_address: o.delivery_address,
    municipality: o.municipality,
    current: current ? toSpecView(current) : null,
    quote: quote ? toSpecView(quote) : null,
    approved_revision_number: o.approved_revision_number,
    spec_state,
    confirmed_at: o.confirmed_at,
    quotation_issued_at: o.quotation_issued_at,
    payment_plan: o.payment_plan,
    preferred_payment_method: o.preferred_payment_method,
    payments: payments
      .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
      .map((p) => ({
        id: p.id, amount: p.amount, payment_type: p.payment_type, payment_method: p.payment_method,
        reference_number: p.reference_number ?? null, paid_at: p.paid_at,
        state: p.verified_by_owner_or_staff ? "verified" : p.rejected_at ? "rejected" : "pending",
        rejection_reason: p.rejection_reason ?? null,
      })),
    revisions: revisions.map((r) => ({
      revision_number: r.revision_number,
      revision_type: r.revision_type,
      created_at: r.created_at,
      changes:
        "backfill" in r.changed_fields
          ? "Original order"
          : r.revision_number === 1
            ? r.revision_type === "customer_request" ? "Your design request" : "Original quotation"
            : describeDiff(r.changed_fields as SpecDiff),
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

/**
 * Scenario 1 — [Accept Quote & Confirm Specifications]: the customer accepts
 * the exact revision AND quotation they were shown (both timestamps recorded
 * atomically). Stale, expired, mismatched or replayed submissions are handled
 * by accept_order_revision on the server.
 */
export async function customerAcceptQuote(
  publicStore: DataStore,
  orderId: string,
  input: {
    revision_id: string;
    expected_revision_number: number;
    accepted_furniture_price: number;
    accepted_delivery_fee: number;
    client_idempotency_key: string;
    accept_specification: boolean;
    accept_quotation: boolean;
    payment_plan?: PaymentPlan;
    payment_method?: PaymentMethod | null;
  },
) {
  if (!input.accept_specification || !input.accept_quotation)
    throw new DomainError("VALIDATION", "Please tick both boxes: the specifications and the quotation.");
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  return recordConfirmation(store, null, {
    order_id: orderId,
    confirmation_method: "Customer Portal PIN",
    confirmed_by_name: o.customer_name,
    revision_number: input.expected_revision_number,
    revision_id: input.revision_id,
    accepted_furniture_price: input.accepted_furniture_price,
    accepted_delivery_fee: input.accepted_delivery_fee,
    client_idempotency_key: input.client_idempotency_key,
    payment_plan: input.payment_plan,
    payment_method: input.payment_method,
  });
}

/** Per phone: at most 3 open self-service requests per 24 hours (simple abuse guard). */
const MAX_OPEN_REQUESTS_PER_PHONE = 3;

/**
 * Option 2 — Design & Request Custom Furniture. The customer designs the piece
 * in the configurator and submits a quote request: status Quote Requested,
 * no price, no paper slip, revision 1 = customer_request. The email is stored
 * UNVERIFIED; the review link sent with the quotation verifies it. No PIN is
 * created. Idempotent on client_request_key.
 */
/** An optional room photo sent with the order (from AR or the camera); stored privately, never under its file name. */
export interface RoomPhotoUpload {
  file: { bytes: Uint8Array; type: string; size: number };
  store: ProofStore;
}

export async function createCustomerRequest(publicStore: DataStore, raw: unknown, roomPhoto?: RoomPhotoUpload | null) {
  const parsed = customerRequestSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please check the highlighted fields.", parsed.error);
  const v = parsed.data;
  const store = publicStore.elevated();
  const existing = await store.listOrders();
  const replay = existing.find((o) => o.client_request_key === v.client_request_key);
  if (replay) throw new DomainError("DUPLICATE_REQUEST", `This request was already sent as ${replay.order_code}.`);
  const since = Date.now() - 24 * 3600_000;
  const recent = existing.filter(
    (o) => ["Quote Requested", "Waiting for Confirmation"].includes(o.status) && o.order_origin === "customer_self_service" &&
      o.customer_phone === v.customer_phone && Date.parse(o.created_at) > since,
  );
  if (recent.length >= MAX_OPEN_REQUESTS_PER_PHONE)
    throw new DomainError("RATE_LIMITED", "You already have open requests. JJ Enterprises will contact you with your quotations.");

  const spec = normalizeSpec({
    furniture_category: v.furniture_category,
    design_variant: v.design_variant,
    width_cm: v.width_cm,
    height_cm: v.height_cm,
    depth_cm: v.depth_cm,
    wood_type: v.wood_type,
    custom_wood_note: v.custom_wood_note || null,
    color_finish: v.color_finish,
    quantity: v.quantity,
  });
  // one permanent Order ID from submission; it is also the online order's paper slip number (migration 009)
  const code = nextOrderCode(existing, new Date().getFullYear());
  let room_photo_path: string | undefined;
  if (roomPhoto && roomPhoto.file.size > 0) {
    const { ext } = checkRoomPhoto(roomPhoto.file);
    room_photo_path = `${code}/${crypto.randomUUID()}.${ext}`;
    await roomPhoto.store.put(room_photo_path, roomPhoto.file.bytes, roomPhoto.file.type);
  }
  const order = await store.insertOrder({
    order_code: code,
    paper_slip_number: code,
    encoded_by_id: null,
    customer_name: v.customer_name,
    customer_phone: v.customer_phone,
    delivery_address: v.delivery_address,
    municipality: v.municipality,
    pin_code_hash: null,
    pin_code_display: null,
    customer_email: v.customer_email,
    has_no_email: false,
    item_name: itemNameFor(spec),
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
    special_instructions: v.special_instructions || null,
    reference_photo_url: v.reference_photo_url || null,
    ...(room_photo_path ? { room_photo_path } : {}),
    specs_confirmed: false,
    status: "Waiting for Confirmation",
    priority_rank: 99,
    priority_label: "Normal",
    assigned_craftsman_id: null,
    furniture_price: null,
    delivery_fee: effectiveDeliveryFee(v.municipality, 0),
    payment_exception_type: "Standard 30/70",
    payment_exception_approved: false,
    estimated_completion_date: null,
    scheduled_delivery_date: null,
    order_origin: "customer_self_service",
    client_request_key: v.client_request_key,
  });
  await store.addSpecRevision({
    order_id: order.id,
    type: "customer_request",
    spec,
    expected_revision: null,
    created_by_role: "customer",
    created_by_id: null,
  });
  await store.insertHistory({
    order_id: order.id,
    from_status: null,
    to_status: "Waiting for Confirmation",
    changed_by_id: null,
    notes: "Online order submitted · specification revision 1 · waiting for the shop to confirm",
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  await store.insertNotification({
    order_id: order.id,
    recipient_phone: null,
    channel: "In-App",
    message_body: `Staff/Owner: new online order ${order.order_code} from ${order.customer_name} — ${order.item_name}, ${order.dimensions}, ${order.wood_type}, ${order.color_finish}. Check the design, then confirm the order.`,
    delivery_status: "Sent",
    created_at: new Date().toISOString(),
  });
  return { order: (await store.getOrder(order.id))! };
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
    is_production_blocking: true,
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
  if (o.status === "Waiting for Confirmation" || o.status === "Quote Requested")
    throw new DomainError("VALIDATION", "Your order is not confirmed yet. The shop will contact you if anything needs to change.");
  const open = (await store.listExceptions(orderId)).filter((e) => e.status === "Pending" && e.requested_by === "Customer (portal)");
  if (open.length >= 3) throw new DomainError("RATE_LIMITED", "You already have open requests. The shop will contact you.");
  return store.insertException({
    order_id: orderId,
    category: kind === "change" ? "Spec Clarification" : "On-Site Scratch Touch-Up / Repair",
    description: kind === "change" ? `Post-confirmation change request: ${text}` : text,
    requested_by: "Customer (portal)",
    status: "Pending",
    // a change request on a Confirmed order holds production until the shop decides
    is_production_blocking: kind === "change",
    resolved_by_id: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  });
}
