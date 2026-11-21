import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { isQuoteExpired } from "@/lib/domain/gate";
import { QUOTE_REVISION_TYPES, type ConsumeReviewResult, type Order, type ProvisioningStatus } from "@/lib/domain/types";
import { customerAcceptQuote, customerOrderView, customerProposeChanges, type CustomerOrderView } from "./customer";
import type { CustomerAuthProvider } from "./customer-auth";
import { newSecret, sha256 } from "./customer-auth";
import { sendEmail, siteUrl } from "./email";

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
/**
 * Issues a single-use review link for the order's CURRENT shop quotation and
 * emails it to orders.customer_email. Only the SHA-256 hash is stored; any
 * older open link for the order stops working. Throws on invalid state.
 */
export async function issueReviewLink(publicStore: DataStore, orderId: string) {
  const store = publicStore.elevated();
  const o = await store.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  if (o.has_no_email || !o.customer_email) throw new DomainError("VALIDATION", "Walk-in order: no email on file (paper slip only).");
  const rev = (await store.listRevisions(orderId)).find((r) => r.revision_number === o.current_revision);
  if (!rev || !QUOTE_REVISION_TYPES.includes(rev.revision_type))
    throw new DomainError("PENDING_REVIEW", "There is no issued quotation to review yet.");
  const raw = newSecret(); // crypto.randomBytes(32), base64url
  const { expires_at, sent_to_email } = await store.issueReviewToken({
    order_id: orderId, revision_id: rev.revision_id, token_hash: sha256(raw), ttl_hours: reviewLinkTtlHours(),
  });
  const link = `${siteUrl()}/customer/review?token=${raw}`;
  const quoteValid = rev.expires_at ? ` The quotation is valid until ${formatDate(rev.expires_at.slice(0, 10))}.` : "";
  const sent = await sendEmail(store, {
    order_id: orderId,
    to: sent_to_email,
    subject: `JJ Furniture quotation for ${o.order_code} — please review`,
    text:
      `Hello ${o.customer_name},\n\nYour quotation for ${o.item_name} is ready: ${formatPeso(rev.quoted_furniture_price)} furniture price` +
      ` + ${formatPeso(rev.quoted_delivery_fee)} delivery.${quoteValid}\n\nReview the exact specification and accept it here (single-use link, ` +
      `expires ${formatDate(expires_at.slice(0, 10))}):\n${link}\n\nIf you did not order from JJ Furniture, ignore this email.`,
  });
  return { status: sent.status, expires_at, sent_to: sent_to_email };
}

/**
 * Called after every issued quotation. Never throws: a missing email or a
 * delivery problem must not undo the committed quotation.
 */
export async function afterQuoteIssued(store: DataStore, orderId: string) {
  try {
    const o = await store.elevated().getOrder(orderId);
    if (!o || o.has_no_email || !o.customer_email) return null;
    return await issueReviewLink(store, orderId);
  } catch (e) {
    console.warn("[review link] not issued:", e instanceof Error ? e.message : e);
    return null;
  }
}

const REASONS: Record<Exclude<ConsumeReviewResult, { ok: true }>["reason"], string> = {
  invalid: "This review link is not valid.",
  used: "This review link was already used. Ask JJ Furniture to send a new one, or log in if you already set a password.",
  replaced: "A newer quotation was sent for this order. Please use the most recent email.",
  expired: "This review link has expired. Ask JJ Furniture to send a new one.",
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
export async function provisionCustomerAccount(publicStore: DataStore, auth: CustomerAuthProvider, orderId: string): Promise<ProvisionResult> {
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
    const returning = !isNew && (await auth.hasPassword(account.id));
    if (returning && fresh.provisioning_status === "linked") {
      if (o.customer_user_id === account.id) return { status: "linked", new_account: false }; // already done: no repeat email
      await sendEmail(store, {
        order_id: orderId,
        to: email,
        subject: `JJ Furniture order ${fresh.order_code} is confirmed`,
        text: `Hello ${fresh.customer_name},\n\nThank you — ${fresh.order_code} (${fresh.item_name}) is confirmed and has been added to your account.\n` +
          `Production starts once your 30% down payment of ${formatPeso(fresh.standard_down_payment_due)} is verified.\n\n` +
          `Log in with your existing password to follow it: ${siteUrl()}/customer/login`,
      });
      return { status: "linked", new_account: false };
    }
    // new account, an account that never set a password, or a retry of a pending set-up email
    if (fresh.provisioning_status === "setup_email_sent" && o.customer_user_id === account.id) return { status: "setup_email_sent", new_account: true };
    const link = await auth.passwordLink(account.id, email, "setup");
    const sent = await sendEmail(store, {
      order_id: orderId,
      to: email,
      subject: "Set your JJ Furniture password",
      text: `Hello ${fresh.customer_name},\n\nThank you — ${fresh.order_code} is confirmed. Create your password to follow all your JJ Furniture orders ` +
        `(this link works once and expires in 24 hours):\n${link}\n\nAfterwards, log in at ${siteUrl()}/customer/login`,
    });
    const status: ProvisioningStatus = sent.status === "Sent" ? "setup_email_sent" : "setup_email_pending";
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

// ----------------------------------------------------------------- dashboard ----
/** Orders of a signed-in customer — only those linked to their verified account. */
export async function customerDashboard(publicStore: DataStore, userId: string) {
  const store = publicStore.elevated();
  const orders = await store.listCustomerOrders(userId);
  return Promise.all(orders.map((o) => customerOrderView(store, o.id).then((v) => ({ id: o.id, view: v }))));
}

/** One order for a signed-in customer; refuses anything not linked to them. */
export async function customerOwnedOrder(publicStore: DataStore, userId: string, orderCode: string): Promise<{ order: Order; view: CustomerOrderView }> {
  const store = publicStore.elevated();
  const o = await store.getOrderByCode(orderCode);
  if (!o || o.customer_user_id !== userId) throw new DomainError("NOT_FOUND", "Order not found.");
  return { order: o, view: await customerOrderView(store, o.id) };
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
