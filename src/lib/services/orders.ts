import { ZodError } from "zod";
import type { DataStore, OrderPatch, SpecInput } from "@/lib/data/store";
import { formatDate } from "@/lib/domain/dates";
import { DomainError } from "@/lib/domain/errors";
import { formatPeso, money } from "@/lib/domain/finance";
import { quoteValidityDays } from "@/lib/domain/gate";
import { assertTransition, isProductionLocked, isValidTransition, rolesAllowedFor } from "@/lib/domain/status";
import {
  PAYMENT_PLAN_LABEL,
  PAYMENT_PLANS,
  CUSTOMER_PAYMENT_METHODS,
  type Actor,
  type ConfirmationMethod,
  type Order,
  type OrderStatus,
  type PaymentExceptionType,
  type PaymentMethod,
  type PaymentPlan,
  type PriorityLabel,
} from "@/lib/domain/types";
import { editOrderSchema, newOrderSchema, specRevisionSchema, type NewOrderInput } from "@/lib/domain/validation";
import { describeDiff, diffSpecs, dimensionsText, itemNameFor, normalizeSpec, type Dims, type SpecDiff } from "@/lib/domain/furniture";
import { nextOrderCode } from "./codes";
import { afterQuotationIssued, provisionOnConfirm } from "./customer-portal";
import type { CustomerAuthProvider } from "./customer-auth";
import { ensureRole } from "./guard";
import { notifyCustomer } from "./notify";

const portalUrl = () => `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/customer/login`;

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
    // one permanent Order ID from submission (migration 009)
    order_code: nextOrderCode(existing, new Date().getFullYear()),
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
    notes: `Encoded from paper slip #${order.paper_slip_number} · specification revision 1 · waiting for confirmation`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  // nothing is emailed yet: the customer hears from the shop once the order is confirmed
  return { order: await mustGetOrder(store, order.id), reviewLink: null };
}

// ------------------------------------------------------------ confirm ------
/**
 * The shop confirms a submitted order (Waiting for Confirmation -> Confirmed).
 * No price is needed yet. Then the customer is emailed: a "create your
 * password" link for a new customer, or a "log in" email for a returning one.
 * The email step runs after the committed confirmation and can never undo it.
 */
export async function confirmOrder(store: DataStore, actor: Actor, auth: CustomerAuthProvider, orderId: string, expectedVersion?: number) {
  ensureRole(actor, ["owner", "staff"], "confirm orders");
  const order = await mustGetOrder(store, orderId);
  if (order.status !== "Waiting for Confirmation")
    throw new DomainError("INVALID_TRANSITION", "Only orders waiting for confirmation can be confirmed.");
  const confirmed = await transitionOrder(store, actor, orderId, "Confirmed", {
    notes: "Order confirmed by the shop · quotation to follow",
    expectedVersion,
  });
  const provisioning = await provisionOnConfirm(store, auth, orderId);
  return { order: await mustGetOrder(store, confirmed.id), provisioning };
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
  /** migration 009: terms and channel chosen with the acceptance */
  payment_plan?: PaymentPlan;
  payment_method?: PaymentMethod | null;
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
    throw new DomainError("FORBIDDEN", "Only the customer can accept through the customer portal.");
  if (!actor && input.confirmation_method !== "Customer Portal PIN") throw new DomainError("FORBIDDEN", "Not allowed.");

  const plan = input.payment_plan ?? "down_30";
  if (!PAYMENT_PLANS.includes(plan)) throw new DomainError("VALIDATION", "Choose 30% down payment, installment or full payment.");
  const method = input.payment_method ?? null;
  if (method && !(CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(method))
    throw new DomainError("VALIDATION", "Choose cash, online payment (GCash / Maya) or bank transfer.");
  const order = await mustGetOrder(store, input.order_id);
  // Checks run in the same order as accept_order_revision(): idempotent replay, stale revision,
  // issued quotation, status, expiry, amounts — all inside the store's single locked operation.
  const revisionId =
    input.revision_id ??
    (await store.listRevisions(order.id)).find((r) => r.revision_number === input.revision_number)?.revision_id;
  if (!revisionId) throw new DomainError("STALE_REVISION", "That revision no longer exists. Please reload.");
  const already = (await store.listConfirmations(order.id)).find((c) => c.client_idempotency_key === input.client_idempotency_key);
  const newCode =
    !already && order.order_code.startsWith("DR-") // legacy draft codes only
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
    payment_plan: plan,
    payment_method: method,
  });
  const confirmed = await mustGetOrder(store, order.id);
  if (res.duplicate) return confirmed; // idempotent replay: nothing new happened
  await store.insertHistory({
    order_id: order.id,
    from_status: order.status,
    to_status: confirmed.status,
    changed_by_id: actor?.id ?? null,
    notes: `Quotation (revision ${res.revision_number}) accepted via ${input.confirmation_method} · ${PAYMENT_PLAN_LABEL[plan]}${method ? `, ${method}` : ""}${newCode ? `; order ID ${order.order_code} → ${newCode}` : ""}`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  await notifyCustomer(
    store,
    confirmed,
    `JJ Enterprises: quotation for ${confirmed.order_code} accepted (${PAYMENT_PLAN_LABEL[plan]}). ${
      plan === "installment"
        ? "The owner will review your installment terms; production starts once they are approved."
        : `Production starts after your ${plan === "full" ? `full payment of ${formatPeso(confirmed.furniture_price ?? 0)}` : `30% down payment of ${formatPeso(confirmed.standard_down_payment_due)}`} is verified.`
    } ${confirmed.customer_email ? "Submit your payment in your JJ Enterprises account." : `Questions? Call the shop with your Order ID ${confirmed.order_code}.`}`,
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
/**
 * Confirm the order and issue its quotation in one step (the price is set while confirming).
 * The quotation form is checked first, so a bad price never leaves a confirmed order without a quote.
 */
export async function confirmAndQuote(
  store: DataStore, actor: Actor, auth: CustomerAuthProvider, orderId: string, expectedVersion: number | undefined,
  raw: unknown, expectedRevision: number | null,
) {
  ensureRole(actor, ["owner", "staff"], "confirm orders");
  const parsed = specRevisionSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const { provisioning } = await confirmOrder(store, actor, auth, orderId, expectedVersion);
  const order = await reviseSpecs(store, actor, orderId, raw, expectedRevision);
  return { provisioning, order };
}

export async function reviseSpecs(store: DataStore, actor: Actor, orderId: string, raw: unknown, expectedRevision: number | null) {
  ensureRole(actor, ["owner", "staff"], "revise specifications");
  const parsed = specRevisionSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const order = await mustGetOrder(store, orderId);
  const v = parsed.data;
  const spec = normalizeSpec({ ...v, custom_wood_note: v.custom_wood_note || null });
  // an online order's design is the customer's choice: the shop only prices it (changes go
  // through a customer proposal). Walk-in orders were typed by the staff and stay editable.
  if (order.order_origin === "customer_self_service" && order.furniture_category) {
    const current = normalizeSpec({
      furniture_category: order.furniture_category, design_variant: order.design_variant, width_cm: order.width_cm, height_cm: order.height_cm,
      depth_cm: order.depth_cm, wood_type: order.wood_type, custom_wood_note: order.custom_wood_note, color_finish: order.color_finish, quantity: order.quantity,
    });
    const changed = Object.keys(diffSpecs({ ...current }, { ...spec }));
    if (changed.length)
      throw new DomainError("VALIDATION", "The customer chose this design. The quotation can only set the price; ask the customer to propose any change.");
  }
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
  const updated = await mustGetOrder(store, orderId);
  // migration 009: a shop revision of a CONFIRMED order is the issued quotation
  const issued = updated.status === "Confirmed";
  const reissue = issued && !!order.quotation_issued_at;
  await store.insertHistory({
    order_id: orderId,
    from_status: order.status,
    to_status: updated.status,
    changed_by_id: actor.id,
    notes: `${issued ? (reissue ? "Quotation re-issued" : "Quotation issued") : "Draft quote updated"} as specification revision ${res.revision_number}${
      Object.keys(res.changed_fields).length && order.current_revision > 0 ? ` (${describeDiff(res.changed_fields as SpecDiff)})` : ""
    }${res.expires_at ? ` — valid until ${formatDate(res.expires_at.slice(0, 10))}` : ""}${issued ? "; customer must accept it and choose payment terms" : ""}`,
    client_transaction_id: null,
    changed_at: new Date().toISOString(),
  });
  if (issued) {
    await afterQuotationIssued(store, orderId, res.revision_number); // "choose how to pay" email (walk-ins: none)
    await notifyCustomer(
      store,
      updated,
      `JJ Enterprises: Your quotation for ${updated.order_code} is ready: ${formatPeso(updated.furniture_price)} + delivery ${formatPeso(
        updated.delivery_fee,
      )}. Valid until ${formatDate(res.expires_at?.slice(0, 10) ?? null)}. ${updated.customer_email ? "Log in to accept it and choose how to pay." : "Please visit the shop to accept it."}`,
    );
  }
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
  if (feeChanged && isProductionLocked(order.status))
    throw new DomainError("SPEC_LOCKED", "The delivery fee is locked once production starts. Use a change request to adjust it.");
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
  if (feeChanged && ["Waiting for Confirmation", "Confirmed"].includes(res.order.status) && res.order.furniture_price != null && !res.order.is_legacy_incomplete && res.order.furniture_category) {
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
    const after = await mustGetOrder(store, o.id);
    if (after.status === "Confirmed" && after.quotation_issued_at) await afterQuotationIssued(store, o.id, after.current_revision);
    return after;
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
  "In Production": (o) => `JJ Enterprises: Your ${o.item_name} (${o.order_code}) is now In Production. Est. completion ${formatDate(o.estimated_completion_date)}.`,
  "Ready for Delivery": (o) =>
    `JJ Enterprises: ${o.order_code} passed quality inspection and is Ready for Delivery. Delivery date: ${formatDate(o.scheduled_delivery_date)}.`,
  "Out for Delivery": (o) =>
    `JJ Enterprises: Your ${o.item_name} (${o.order_code}) is out for delivery today. Amount to prepare: ${formatPeso(o.collectible_on_delivery)}.`,
  Delivered: (o) => `JJ Enterprises: ${o.order_code} delivered. Salamat! Report any scratch or repair need: log in at ${portalUrl()} or call the shop.`,
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
  // Riders may only read the payments they collected themselves (RLS), so the
  // down-payment check reads all verified payments with the server's elevated access.
  // This is a read only: the update below still runs as the actor.
  const paymentsReader = actor.role === "driver" ? store.elevated() : writer;
  assertTransition(order, to, await paymentsReader.listPayments(orderId));

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

/** Owner / staff assign (or unassign) the craftsman for an accepted or running job. Recorded in the history. */
export async function assignCraftsman(store: DataStore, actor: Actor, orderId: string, craftsmanId: string | null) {
  ensureRole(actor, ["owner", "staff"], "assign craftsmen");
  const order = await mustGetOrder(store, orderId);
  if (!["Confirmed", "In Production", "Completed / For Inspection"].includes(order.status))
    throw new DomainError("VALIDATION", "Craftsmen are assigned to confirmed or running jobs only.");
  if (craftsmanId) {
    const p = (await store.listProfiles()).find((x) => x.id === craftsmanId);
    if (!p || p.role !== "craftsman" || !p.is_active) throw new DomainError("VALIDATION", "Choose an active craftsman.");
  }
  if (order.assigned_craftsman_id === craftsmanId) return order;
  const res = await store.updateOrder(orderId, { assigned_craftsman_id: craftsmanId }, order.version);
  if (!res.ok) throw new DomainError("VERSION_CONFLICT", "This order was changed by someone else. Please refresh.");
  const name = craftsmanId ? (await store.listProfiles()).find((x) => x.id === craftsmanId)?.full_name : null;
  await store.insertHistory({
    order_id: orderId, from_status: order.status, to_status: order.status, changed_by_id: actor.id,
    notes: name ? `Assigned to ${name}` : "Craftsman unassigned", client_transaction_id: null, changed_at: new Date().toISOString(),
  });
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
