import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { isQuoteExpired } from "@/lib/domain/gate";
import { QUOTE_REVISION_TYPES, type ConsumeReviewResult, type Order, type PaymentMethod, type PaymentPlan, type ProvisioningStatus } from "@/lib/domain/types";
import { customerAcceptQuote, customerOrderView, customerProposeChanges, customerRequestRepair, type CustomerOrderView } from "./customer";
import type { CustomerAuthProvider } from "./customer-auth";
import { newSecret, sha256 } from "./customer-auth";
import { loadKeyring } from "@/lib/email/crypto";
import { enqueueEmail, kickOutbox } from "@/lib/email/outbox";
import type { TemplateData } from "@/lib/email/templates";
import type { SpecRevision } from "@/lib/domain/types";

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** How long a quote review link stays valid (REVIEW_LINK_TTL_HOURS, default 72 h, 1–336). */
export function reviewLinkTtlHours(): number {
  const n = Number(process.env.REVIEW_LINK_TTL_HOURS ?? 72);
  return Number.isFinite(n) ? Math.min(336, Math.max(1, Math.round(n))) : 72;
}

/** The scope a review session may touch: exactly one order and one quotation revision. */
export interface ReviewScope {
  order_id: string;
  revision_id: string;
}

// ------------------------------------------------------------ review links ----
/** Non-secret summary shown in emails (stored as outbox template data). */
export function orderTemplateData(o: Order, rev?: SpecRevision | null): TemplateData {
  const price = rev?.quoted_furniture_price ?? o.furniture_price ?? 0;
  const fee = rev?.quoted_delivery_fee ?? o.delivery_fee ?? 0;
  return {
    customer_name: o.customer_name,
    order_code: o.order_code,
    item_summary: `${o.quantity} × ${o.item_name} · ${o.dimensions} · ${o.wood_type}, ${o.color_finish}`,
    total: formatPeso(price + fee),
    down_payment: formatPeso(o.standard_down_payment_due || Math.round(price * 30) / 100),
    quote_expires: rev?.expires_at ? formatDate(rev.expires_at.slice(0, 10)) : null,
  };
}

export type EmailDelivery = "sent" | "pending" | "failed";
const deliveryOf = (s: string): EmailDelivery => (s === "sent" ? "sent" : s === "failed" ? "failed" : "pending");

/**
 * Issues a single-use review link for the order's CURRENT shop quotation and
 * queues the "quotation ready" email. Only the SHA-256 hash is stored in
 * quote_review_tokens; the raw token waits in the outbox AES-256-GCM encrypted
 * and is scrubbed once sent, consumed or replaced. Older open links for the
 * order stop working. `manual` = an explicit staff resend (new idempotency key,
 * audited requester). Throws on invalid state.
 */
export async function issueReviewLink(publicStore: DataStore, orderId: string, opts: { requestedBy?: string | null } = {}) {
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  if (o.has_no_email || !o.customer_email) throw new DomainError("VALIDATION", "Walk-in order: no email on file (paper slip only).");
  const rev = (await store.listRevisions(orderId)).find((r) => r.revision_number === o.current_revision);
  if (!rev || !QUOTE_REVISION_TYPES.includes(rev.revision_type))
    throw new DomainError("PENDING_REVIEW", "There is no issued quotation to review yet.");
  // fail closed BEFORE issuing: a new token invalidates older links, so never issue one we cannot queue
  try {
    loadKeyring();
  } catch {
    throw new DomainError("BACKEND", "Email encryption key is not configured — no review link was issued (previous links still work).");
  }
  const raw = newSecret(); // crypto.randomBytes(32), base64url — never stored in plaintext
  const { token_id, expires_at, sent_to_email } = await store.issueReviewToken({
    order_id: orderId, revision_id: rev.revision_id, token_hash: sha256(raw), ttl_hours: reviewLinkTtlHours(),
  });
  const { row } = await enqueueEmail(store, {
    kind: "quote_review_ready",
    order_id: orderId,
    recipient_email: sent_to_email,
    review_token_id: token_id,
    template_data: { ...orderTemplateData(o, rev), link_expires: formatDate(expires_at.slice(0, 10)) },
    idempotency_key: opts.requestedBy ? `resend:${crypto.randomUUID()}` : `quote_review:${token_id}`,
    requested_by_user_id: opts.requestedBy ?? null,
    secret: { token: raw },
  });
  const status = deliveryOf(await kickOutbox(store, row.id));
  return { status, expires_at, sent_to: sent_to_email, outbox_id: row.id };
}

const REASONS: Record<Exclude<ConsumeReviewResult, { ok: true }>["reason"], string> = {
  invalid: "This review link is not valid.",
  used: "This review link was already used. Ask JJ Enterprises to send a new one, or log in if you already set a password.",
  replaced: "A newer quotation was sent for this order. Please use the most recent email.",
  expired: "This review link has expired. Ask JJ Enterprises to send a new one.",
  email_changed: "The email on this order changed, so this link no longer works.",
};

/** Atomically consumes the link (single use) and returns the review scope. */
export async function openReviewLink(publicStore: DataStore, rawToken: string): Promise<ReviewScope> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(rawToken)) throw new DomainError("VALIDATION", REASONS.invalid);
  const r = await publicStore.elevated().consumeReviewToken(sha256(rawToken));
  if (!r.ok) throw new DomainError("VALIDATION", REASONS[r.reason]);
  return { order_id: r.order_id, revision_id: r.revision_id };
}

// ---------------------------------------------------------------- review view ----
export interface ReviewView {
  scope_current: boolean; // the scoped revision is still the order's latest
  /** the customer already sent changes for this quotation from this session */
  proposal_pending: boolean;
  quote_expired: boolean;
  accepted: boolean; // this exact revision was accepted
  order: CustomerOrderView;
  revision_number: number;
}

/** Read model for a review session — only the one scoped order and revision. */
export async function reviewView(publicStore: DataStore, scope: ReviewScope): Promise<ReviewView> {
  const store = publicStore.elevated();
  const o = await store.getOrder(scope.order_id);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  const rev = (await store.listRevisions(o.id)).find((r) => r.revision_id === scope.revision_id);
  if (!rev) throw new DomainError("NOT_FOUND", "Quotation not found.");
  const accepted = (await store.listConfirmations(o.id)).some((c) => c.revision_id === scope.revision_id);
  const latest = (await store.listRevisions(o.id)).find((r) => r.revision_number === o.current_revision);
  return {
    scope_current: rev.revision_number === o.current_revision,
    proposal_pending: latest?.revision_type === "customer_proposal" && latest.revision_number === rev.revision_number + 1,
    quote_expired: isQuoteExpired(rev),
    accepted,
    order: await customerOrderView(store, o.id),
    revision_number: rev.revision_number,
  };
}

// --------------------------------------------------- acceptance + provisioning ----
/**
 * [Accept Quote & Confirm Specifications] inside a review session. The
 * acceptance goes through the existing approval engine (accept_order_revision)
 * for the SCOPED revision only and is committed first. Account provisioning /
 * linking runs afterwards as a recoverable step and can never undo it.
 */
export async function acceptFromReview(
  publicStore: DataStore,
  auth: CustomerAuthProvider,
  scope: ReviewScope,
  input: { accepted_furniture_price: number; accepted_delivery_fee: number; client_idempotency_key: string; accept_specification: boolean; accept_quotation: boolean },
) {
  const store = publicStore.elevated();
  const rev = (await store.listRevisions(scope.order_id)).find((r) => r.revision_id === scope.revision_id);
  if (!rev) throw new DomainError("NOT_FOUND", "Quotation not found.");
  const order = await customerAcceptQuote(store, scope.order_id, {
    revision_id: scope.revision_id, // never taken from the browser
    expected_revision_number: rev.revision_number,
    accepted_furniture_price: input.accepted_furniture_price,
    accepted_delivery_fee: input.accepted_delivery_fee,
    client_idempotency_key: input.client_idempotency_key,
    accept_specification: input.accept_specification,
    accept_quotation: input.accept_quotation,
  });
  const provisioning = await provisionCustomerAccount(store, auth, scope.order_id);
  return { order, provisioning };
}

export interface ProvisionResult {
  status: ProvisioningStatus;
  /** for messages: whether a password set-up email went out */
  new_account: boolean;
  detail?: string;
}

async function setStatus(store: DataStore, orderId: string, status: ProvisioningStatus) {
  const o = await store.getOrder(orderId);
  if (!o || o.provisioning_status === status) return;
  await store.updateOrder(orderId, { provisioning_status: status });
}

/**
 * Post-acceptance provisioning (idempotent, safe to retry, never throws):
 *  - walk-in / no email        -> not_applicable
 *  - email not verified        -> pending (nothing is linked)
 *  - existing customer account -> link the order, no password change, "log in" email
 *  - new customer              -> create a login WITHOUT a password, link, email a
 *                                 time-limited password set-up link
 */
export async function provisionCustomerAccount(
  publicStore: DataStore,
  auth: CustomerAuthProvider,
  orderId: string,
  opts: { requestedBy?: string | null } = {},
): Promise<ProvisionResult> {
  const store = publicStore.elevated();
  try {
    const o = await store.getOrder(orderId);
    if (!o) return { status: "failed", new_account: false, detail: "Order not found" };
    if (o.has_no_email || !o.customer_email) return { status: "not_applicable", new_account: false };
    if (!o.email_verified_at) {
      await setStatus(store, orderId, "pending");
      return { status: "pending", new_account: false, detail: "Email not verified yet" };
    }
    const email = o.customer_email;
    if (await store.emailBelongsToStaff(email)) {
      await setStatus(store, orderId, "failed");
      return { status: "failed", new_account: false, detail: "This email belongs to a staff login; staff must use a different customer email." };
    }

    let account = await store.findCustomerAccountByEmail(email);
    const isNew = !account;
    if (!account) {
      try {
        const id = await auth.createAccount(email, o.customer_name);
        account = await store.getCustomerAccount(id);
        await setStatus(store, orderId, "account_created");
      } catch {
        account = await store.findCustomerAccountByEmail(email); // created concurrently: reuse it
      }
    }
    if (!account) throw new Error("Account could not be created");

    if (o.customer_user_id !== account.id) await store.linkCustomerAccount(orderId, account.id);

    const fresh = (await store.getOrder(orderId))!;
    const tpl = orderTemplateData(fresh, (await store.listRevisions(orderId)).find((r) => r.revision_number === fresh.approved_revision_number));
    // explicit staff resends get a fresh, audited idempotency key; automatic flows stay idempotent
    const key = (auto: string) => (opts.requestedBy ? `resend:${crypto.randomUUID()}` : auto);
    const returning = !isNew && (await auth.hasPassword(account.id));
    if (returning && fresh.provisioning_status === "linked") {
      if (o.customer_user_id === account.id && !opts.requestedBy) return { status: "linked", new_account: false }; // already done: no repeat email
      const { row } = await enqueueEmail(store, {
        kind: "order_confirmed_returning_customer", order_id: orderId, recipient_email: email, customer_user_id: account.id,
        template_data: tpl, idempotency_key: key(`order_confirmed_returning:${orderId}:${account.id}`), requested_by_user_id: opts.requestedBy ?? null,
      });
      await kickOutbox(store, row.id, { auth });
      return { status: "linked", new_account: false };
    }
    // new account, an account that never set a password, or a retry of a pending set-up email
    if (fresh.provisioning_status === "setup_email_sent" && o.customer_user_id === account.id && !opts.requestedBy) return { status: "setup_email_sent", new_account: true };
    // the set-up link itself is generated by the outbox at send time (Supabase recovery link), never stored in plaintext
    const { row } = await enqueueEmail(store, {
      kind: "order_confirmed_new_customer", order_id: orderId, recipient_email: email, customer_user_id: account.id,
      template_data: tpl, idempotency_key: key(`order_confirmed_new:${orderId}:${account.id}`), requested_by_user_id: opts.requestedBy ?? null,
    });
    const delivered = await kickOutbox(store, row.id, { auth });
    const status: ProvisioningStatus = delivered === "sent" ? "setup_email_sent" : "setup_email_pending";
    await setStatus(store, orderId, status);
    return { status, new_account: true };
  } catch (e) {
    console.warn("[provisioning] failed:", e instanceof Error ? e.message : e);
    try {
      await setStatus(store, orderId, "failed");
    } catch {
      /* the acceptance stays committed either way */
    }
    return { status: "failed", new_account: false, detail: e instanceof Error ? e.message : "Provisioning failed" };
  }
}

// ------------------------------------------------- confirm + quotation emails (009) ----
/**
 * After the shop CONFIRMS an order (migration 009). Idempotent, never throws:
 *  - walk-in / no email          -> not_applicable
 *  - staff email                 -> failed (never turned into a customer login)
 *  - account with a password     -> "order confirmed, log in" email
 *  - no account / no password    -> login created WITHOUT a password + "create your password" email
 * The order is NOT linked here: the email is unproven. It is linked by
 * claim_customer_orders() once the inbox owner signs in (a password exists only
 * after the set-up link sent to that inbox was completed).
 */
export async function provisionOnConfirm(
  publicStore: DataStore,
  auth: CustomerAuthProvider,
  orderId: string,
  opts: { requestedBy?: string | null } = {},
): Promise<ProvisionResult> {
  const store = publicStore.elevated();
  try {
    const o = await store.getOrder(orderId);
    if (!o) return { status: "failed", new_account: false, detail: "Order not found" };
    if (o.has_no_email || !o.customer_email) return { status: "not_applicable", new_account: false };
    const email = o.customer_email;
    if (await store.emailBelongsToStaff(email)) {
      await setStatus(store, orderId, "failed");
      return { status: "failed", new_account: false, detail: "This email belongs to a staff login; use a different customer email." };
    }
    let account = await store.findCustomerAccountByEmail(email);
    if (!account) {
      try {
        account = await store.getCustomerAccount(await auth.createAccount(email, o.customer_name));
      } catch {
        account = await store.findCustomerAccountByEmail(email); // created concurrently: reuse it
      }
    }
    if (!account) throw new Error("Account could not be created");
    const tpl = orderTemplateData(o);
    const key = (auto: string) => (opts.requestedBy ? `resend:${crypto.randomUUID()}` : auto);
    if (await auth.hasPassword(account.id)) {
      const { row } = await enqueueEmail(store, {
        kind: "order_confirmed_returning_customer", order_id: orderId, recipient_email: email, customer_user_id: account.id,
        template_data: tpl, idempotency_key: key(`order_confirmed_returning:${orderId}:${account.id}`), requested_by_user_id: opts.requestedBy ?? null,
      });
      await kickOutbox(store, row.id, { auth });
      return { status: "pending", new_account: false };
    }
    // the set-up link is generated by the outbox at send time (never stored in plaintext)
    const { row } = await enqueueEmail(store, {
      kind: "order_confirmed_new_customer", order_id: orderId, recipient_email: email, customer_user_id: account.id,
      template_data: tpl, idempotency_key: key(`order_confirmed_new:${orderId}:${account.id}`), requested_by_user_id: opts.requestedBy ?? null,
    });
    const status: ProvisioningStatus = (await kickOutbox(store, row.id, { auth })) === "sent" ? "setup_email_sent" : "setup_email_pending";
    await setStatus(store, orderId, status);
    return { status, new_account: true };
  } catch (e) {
    console.warn("[provisioning] failed:", e instanceof Error ? e.message : e);
    try { await setStatus(store, orderId, "failed"); } catch { /* the confirmation stays committed */ }
    return { status: "failed", new_account: false, detail: e instanceof Error ? e.message : "Provisioning failed" };
  }
}

/**
 * After the quotation is issued for a Confirmed order: the "choose how to pay"
 * email. It carries no secret: the link opens the order page, which requires
 * the customer's own login. Never throws.
 */
export async function afterQuotationIssued(publicStore: DataStore, orderId: string, revisionNumber: number) {
  const store = publicStore.elevated();
  try {
    const o = await store.getOrder(orderId);
    if (!o || o.has_no_email || !o.customer_email) return null;
    const rev = (await store.listRevisions(orderId)).find((r) => r.revision_number === revisionNumber);
    const { row } = await enqueueEmail(store, {
      kind: "quotation_payment_request", order_id: orderId, recipient_email: o.customer_email,
      template_data: orderTemplateData(o, rev), idempotency_key: `quotation_payment:${orderId}:${revisionNumber}`,
    });
    return deliveryOf(await kickOutbox(store, row.id));
  } catch (e) {
    console.warn("[quotation email] not queued:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ----------------------------------------------------------------- dashboard ----
/**
 * A SIGNED-IN customer proved ownership of their inbox (their password could only
 * be set through a link sent to it), so the shop-confirmed orders that carry that
 * email are linked to them now (claim_customer_orders). Never throws.
 */
async function claimForSignedInCustomer(customerStore: DataStore, userId: string) {
  try {
    await customerStore.elevated().claimCustomerOrders(userId);
  } catch (e) {
    console.warn("[claim] skipped:", e instanceof DomainError ? e.message : "server error");
  }
}

/**
 * A signed-in customer's orders. `customerStore` must be the customer-scoped
 * store (getCustomerStore): in production its reads carry the customer's JWT,
 * so RLS (orders_select_customer_own) returns only their rows; the explicit
 * customer_user_id check below is the second, independent layer. Details
 * (revisions, payments, history) are then loaded elevated for those ids only.
 */
export async function customerDashboard(customerStore: DataStore, userId: string) {
  await claimForSignedInCustomer(customerStore, userId);
  const owned = (await customerStore.listCustomerOrders(userId)).filter((o) => o.customer_user_id === userId);
  const store = customerStore.elevated();
  return Promise.all(owned.map((o) => customerOrderView(store, o.id).then((v) => ({ id: o.id, view: v }))));
}

/** One order for a signed-in customer; anything not linked to them is NOT_FOUND (no existence leak). */
export async function customerOwnedOrder(customerStore: DataStore, userId: string, orderCode: string): Promise<{ order: Order; view: CustomerOrderView }> {
  await claimForSignedInCustomer(customerStore, userId);
  const o = await customerStore.getOrderByCode(orderCode); // RLS-filtered in production
  if (!o || o.customer_user_id !== userId) throw new DomainError("NOT_FOUND", "Order not found.");
  return { order: o, view: await customerOrderView(customerStore.elevated(), o.id) };
}

/**
 * A signed-in customer accepts the ISSUED quotation of their own Confirmed order
 * and chooses the payment terms + channel (migration 009). The revision id is
 * taken from the server's view of the order, never from the browser.
 */
export async function customerOwnedAccept(
  customerStore: DataStore,
  userId: string,
  orderCode: string,
  input: {
    expected_revision_number: number;
    accepted_furniture_price: number;
    accepted_delivery_fee: number;
    client_idempotency_key: string;
    accept_specification: boolean;
    accept_quotation: boolean;
    payment_plan: PaymentPlan;
    payment_method: PaymentMethod | null;
  },
) {
  const { order } = await customerOwnedOrder(customerStore, userId, orderCode);
  const store = customerStore.elevated();
  const rev = (await store.listRevisions(order.id)).find((r) => r.revision_number === input.expected_revision_number);
  if (!rev) throw new DomainError("STALE_REVISION", "This quotation changed. Please reload the page.");
  return customerAcceptQuote(store, order.id, { ...input, revision_id: rev.revision_id });
}

/** "Request Post-Confirmation Change / Repair" from the signed-in dashboard: own orders only. */
export async function customerOwnedRequest(
  customerStore: DataStore,
  userId: string,
  orderCode: string,
  description: string,
  kind: "change" | "repair",
) {
  const { order } = await customerOwnedOrder(customerStore, userId, orderCode);
  return customerRequestRepair(customerStore.elevated(), order.id, description, kind);
}

/**
 * "Submit Specification Changes for Review" from a review session: a new
 * customer_proposal revision for the scoped order only (the existing proposal
 * flow); the shop re-quotes and a fresh review link is emailed.
 */
export async function proposeFromReview(publicStore: DataStore, scope: ReviewScope, raw: unknown) {
  const store = publicStore.elevated();
  const rev = (await store.listRevisions(scope.order_id)).find((r) => r.revision_id === scope.revision_id);
  if (!rev) throw new DomainError("NOT_FOUND", "Quotation not found.");
  return customerProposeChanges(store, scope.order_id, rev.revision_number, raw);
}
