import { ZodError } from "zod";
import type { DataStore, OrderPatch, SpecInput } from "@/lib/data/store";
import { formatDate } from "@/lib/domain/dates";
import { DomainError } from "@/lib/domain/errors";
import { formatPeso, money } from "@/lib/domain/finance";
import { quoteValidityDays } from "@/lib/domain/gate";
import { assertTransition, isValidTransition, rolesAllowedFor } from "@/lib/domain/status";
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
import { afterQuoteIssued } from "./customer-portal";
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
  if (existing.some((o) => o.paper_slip_number?.toLowerCase() === input.paper_slip_number.toLowerCase())) {
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
  // Email authentication replaces the 4-digit PIN for new orders (migration 005).
  const order = await store.insertOrder({
    order_code: nextDraftCode(existing),
    paper_slip_number: input.paper_slip_number,
    encoded_by_id: input.encoded_by_id,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
    delivery_address: input.delivery_address,
    municipality: input.municipality,
    pin_code_hash: null,
    pin_code_display: null,
    customer_email: input.has_no_email ? null : input.customer_email,
    has_no_email: input.has_no_email,
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
    order_origin: "staff_intake",
  });
  // revision 1: the staff draft quotation (valid QUOTE_VALIDITY_DAYS) the customer will accept
  await store.addSpecRevision({
    order_id: order.id,
    type: "staff_draft",
    spec: { ...spec, quoted_furniture_price: input.furniture_price, quoted_delivery_fee: input.delivery_fee },
    expected_revision: null,
    created_by_role: actor.role,
    created_by_id: actor.id,
    quote_validity_days: quoteValidityDays(),
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
  // emailed single-use review link for the staff draft quotation (unverified email; never blocks the save)
  const reviewLink = await afterQuoteIssued(store, order.id);
  return { order: await mustGetOrder(store, order.id), reviewLink };
}

// --------------------------------------------------------- acceptance ------
export interface AcceptanceInput {
  order_id: string;
  confirmation_method: ConfirmationMethod;
  confirmed_by_name: string;
  /** what the accepting person was shown */
  revision_number: number;
  revision_id?: string;
  accepted_furniture_price: number;
  accepted_delivery_fee: number;
  client_idempotency_key: string;
}

/**
 * Records the explicit acceptance of ONE exact revision: its specification AND
 * its quotation, atomically (accept_order_revision). Rejects stale revisions,
 * expired quotations and amounts that differ from the quote; replaying the same
 * idempotency key returns the original acceptance without a duplicate.
 */
export async function recordConfirmation(store: DataStore, actor: Actor | null, input: AcceptanceInput) {
  if (actor) ensureRole(actor, ["owner", "staff"], "record customer acceptance");
  if (actor && input.confirmation_method === "Customer Portal PIN")
    throw new DomainError("FORBIDDEN", "Only the customer can accept through the PIN portal.");
  if (!actor && input.confirmation_method !== "Customer Portal PIN") throw new DomainError("FORBIDDEN", "Not allowed.");

  const order = await mustGetOrder(store, input.order_id);
  // Checks run in the same order as accept_order_revision(): idempotent replay, stale revision,
  // issued quotation, status, expiry, amounts — all inside the store's single locked operation.
  const revisionId =
    input.revision_id ??
    (await store.listRevisions(order.id)).find((r) => r.revision_number === input.revision_number)?.revision_id;
  if (!revisionId) throw new DomainError("STALE_REVISION", "That revision no longer exists. Please reload.");
  const already = (await store.listConfirmations(order.id)).find((c) => c.client_idempotency_key === input.client_idempotency_key);
  const newCode =
    !already && order.status === "Waiting for Confirmation" && order.order_code.startsWith("DR-")
      ? nextOrderCode(await store.listOrders(), Number(new Date().getFullYear()), order.order_code)
      : null;
  const res = await store.acceptOrderRevision({
    order_id: order.id,
    revision_id: revisionId,
    expected_revision_number: input.revision_number,
    accepted_furniture_price: money(input.accepted_furniture_price),
    accepted_delivery_fee: money(input.accepted_delivery_fee),
    accepted_total_amount: money(input.accepted_furniture_price + input.accepted_delivery_fee),
    client_idempotency_key: input.client_idempotency_key,
    method: input.confirmation_method,
    confirmed_by_name: input.confirmed_by_name,
    recorded_by: actor?.id ?? null,
    new_order_code: newCode,
  });
  const confirmed = await mustGetOrder(store, order.id);
  if (res.duplicate) return confirmed; // idempotent replay: nothing new happened
  await store.insertHistory({
    order_id: order.id,
    from_status: order.status,
    to_status: "Confirmed",
    changed_by_id: actor?.id ?? null,
    notes: `Specification + quotation of revision ${res.revision_number} accepted via ${input.confirmation_method}${newCode ? `; order ID ${order.order_code} → ${newCode}` : ""}`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  await notifyCustomer(
    store,
    confirmed,
    `JJ Furniture: ${confirmed.order_code} (${confirmed.item_name}) is confirmed. Production starts after your 30% down payment of ${formatPeso(
      confirmed.standard_down_payment_due,
    )} is verified. ${confirmed.customer_email ? "Follow it in your JJ Furniture account." : `Check the status at ${trackUrl()} with your Order ID.`}`,
  );
  return confirmed;
}

/**
 * Staff/owner issue a quotation as a new immutable revised_quote revision (spec
 * + price + fee, valid QUOTE_VALIDITY_DAYS). Quoting a customer self-service
 * request (Quote Requested) also records the paper slip # and completion date
 * and moves it to Waiting for Confirmation — all in one transaction. Any change
 * voids a previous acceptance.
 */
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
    quote_validity_days: quoteValidityDays(),
    paper_slip_number: v.paper_slip_number || null,
    estimated_completion_date: v.estimated_completion_date || null,
  });
  const firstQuote = order.status === "Quote Requested";
  await store.insertHistory({
    order_id: orderId,
    from_status: order.status,
    to_status: "Waiting for Confirmation",
    changed_by_id: actor.id,
    notes: `${firstQuote ? "Official quotation issued" : "Revised quote issued"} as specification revision ${res.revision_number}${
      !firstQuote && Object.keys(res.changed_fields).length ? ` (${describeDiff(res.changed_fields as SpecDiff)})` : ""
    }${res.expires_at ? ` — valid until ${formatDate(res.expires_at.slice(0, 10))}` : ""}; customer must accept it`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  const updated = await mustGetOrder(store, orderId);
  await afterQuoteIssued(store, orderId); // single-use review link to the customer's email (walk-ins: none)
  if (firstQuote)
    await notifyCustomer(
      store,
      updated,
      `JJ Furniture: Your quotation for ${updated.order_code} is ready: ${formatPeso(updated.furniture_price)} + delivery ${formatPeso(
        updated.delivery_fee,
      )}. Valid until ${formatDate(res.expires_at?.slice(0, 10) ?? null)}. ${updated.customer_email ? "We emailed you a link to review and accept it." : "Please visit the shop to accept it."}`,
    );
  return updated;
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
  if (feeChanged && order.status !== "Waiting for Confirmation" && order.status !== "Quote Requested")
    throw new DomainError("SPEC_LOCKED", "The delivery fee is part of the confirmed quote. Use a change request to adjust it.");
  const email = v.has_no_email ? null : v.customer_email || null;
  if (!email && !v.has_no_email && !order.legacy_contact_unknown)
    throw new DomainError("VALIDATION", "Enter the customer's email, or tick Walk-In / No Email (paper slip only).",
      new ZodError([{ code: "custom", path: ["customer_email"], message: "Enter the customer's email, or tick Walk-In / No Email (paper slip only).", input: "" }]));
  const emailChanged = email !== order.customer_email || v.has_no_email !== order.has_no_email;
  const res = await store.updateOrder(
    orderId,
    {
      ...(emailChanged ? { customer_email: email, has_no_email: v.has_no_email } : {}),
      customer_phone: v.customer_phone,
      delivery_address: v.delivery_address,
      municipality: v.municipality,
      delivery_fee: v.delivery_fee,
      special_instructions: v.special_instructions || null,
      reference_photo_url: v.reference_photo_url || null,
      estimated_completion_date: order.status === "Quote Requested" ? order.estimated_completion_date : v.estimated_completion_date,
      scheduled_delivery_date: v.scheduled_delivery_date || null,
    },
    order.version,
  );
  if (!res.ok) throw new DomainError("VERSION_CONFLICT", "This order was changed by someone else. Please refresh.");
  // A fee change is a new quote: record it as a revision the customer must confirm.
  if (feeChanged && res.order.status === "Waiting for Confirmation" && !res.order.is_legacy_incomplete && res.order.furniture_category) {
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
      quote_validity_days: quoteValidityDays(),
    });
    await afterQuoteIssued(store, o.id);
    return mustGetOrder(store, o.id);
  }
  // a newly added / changed email starts unverified; send it the current quotation's review link
  if (emailChanged && email && res.order.status === "Waiting for Confirmation") await afterQuoteIssued(store, orderId);
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
  if (!isValidTransition(order.status, to))
    throw new DomainError("INVALID_TRANSITION", `Cannot move an order from "${order.status}" to "${to}".`);
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

/**
 * Releases a Confirmed order to the workshop (Confirmed -> In Production).
 * Owner/staff only; the server re-checks the verified 30% down payment (or an
 * owner-approved credit/installment exception), the accepted latest revision,
 * no price/spec drift and no production-blocking items.
 */
export async function startProduction(store: DataStore, actor: Actor, orderId: string, craftsmanId?: string | null) {
  ensureRole(actor, ["owner", "staff"], "release orders to production");
  const order = await mustGetOrder(store, orderId);
  if (order.status !== "Confirmed") throw new DomainError("INVALID_TRANSITION", "Only Confirmed orders can be released to production.");
  if (craftsmanId !== undefined && craftsmanId !== order.assigned_craftsman_id) {
    const res = await store.updateOrder(orderId, { assigned_craftsman_id: craftsmanId }, order.version);
    if (!res.ok) throw new DomainError("VERSION_CONFLICT", "This order was changed by someone else. Please refresh.");
  }
  return transitionOrder(store, actor, orderId, "In Production", {
    notes: "Released to the workshop: 30% down payment verified (or owner-approved exception) — specification locked",
  });
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
    .sort((a, b) => a.priority_rank - b.priority_rank || (a.estimated_completion_date ?? "").localeCompare(b.estimated_completion_date ?? ""));
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
