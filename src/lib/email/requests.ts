import "server-only";
import { z } from "zod";
import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import type { Actor } from "@/lib/domain/types";
import { hmacId } from "@/lib/server/token";
import type { CustomerAuthProvider } from "@/lib/services/customer-auth";
import { issueReviewLink, provisionCustomerAccount } from "@/lib/services/customer-portal";
import { enqueueEmail, kickOutbox } from "./outbox";

/** The ONLY answer the public setup-link endpoint ever gives for a well-formed request. */
export const SETUP_LINK_GENERIC = "If an eligible account exists for this email, a password setup link has been sent.";
export const SETUP_LINK_RATE_LIMITED = "Too many requests. Please wait a while and try again.";

export const SETUP_LIMITS = { perIp: { max: 10, windowS: 3600 }, perEmail: { max: 3, windowS: 3600 } };
export const RESEND_LIMITS = { perOrder: { max: 5, windowS: 3600 }, perUser: { max: 30, windowS: 3600 } };

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * POST /api/auth/request-setup-link (and the "Forgot Password?" form).
 * Never creates an account. Sends a fresh password set-up link only when an
 * ACTIVE customer account with a VERIFIED email exists that is linked to at
 * least one of its orders under the account-linking rules. The caller always
 * gets the same generic answer; delivery runs after the response (`defer`) so
 * the timing does not reveal eligibility either.
 */
export async function requestSetupLink(
  store: DataStore,
  auth: CustomerAuthProvider,
  input: { email: unknown; clientIp: string },
  defer: (task: () => Promise<unknown>) => void,
): Promise<{ status: 200 | 429; message: string }> {
  const db = store.elevated();
  const parsed = emailSchema.safeParse(input.email);
  const email = parsed.success ? parsed.data : "";
  const ipOk = await db.hitRateLimit(`setup:ip:${hmacId("ip", input.clientIp || "unknown")}`, SETUP_LIMITS.perIp.windowS, SETUP_LIMITS.perIp.max);
  const emailOk = email ? await db.hitRateLimit(`setup:email:${hmacId("email", email)}`, SETUP_LIMITS.perEmail.windowS, SETUP_LIMITS.perEmail.max) : true;
  // limits are keyed by IP and by the HMAC of the address, never by account existence: no enumeration
  if (!ipOk || !emailOk) return { status: 429, message: SETUP_LINK_RATE_LIMITED };
  if (!email) return { status: 200, message: SETUP_LINK_GENERIC };

  defer(async () => {
    try {
      const acct = await db.findCustomerAccountByEmail(email);
      if (!acct?.is_active) return;
      if (!(await auth.emailVerified(acct.id))) return;
      const linked = (await db.listCustomerOrders(acct.id)).some((o) => o.customer_user_id === acct.id && !!o.email_verified_at && o.customer_email === email);
      if (!linked) return;
      const { row } = await enqueueEmail(db, {
        kind: "account_setup_link", order_id: null, recipient_email: email, customer_user_id: acct.id,
        template_data: { customer_name: acct.full_name }, idempotency_key: `setup:${crypto.randomUUID()}`,
      });
      await kickOutbox(db, row.id, { auth });
    } catch (e) {
      console.warn("[setup-link] request not completed:", e instanceof Error ? e.name : "error"); // no address, no link
    }
  });
  return { status: 200, message: SETUP_LINK_GENERIC };
}

export type ResendKind = "quote_review" | "account_setup";

/**
 * POST /api/notifications/resend (and the staff "Resend" buttons). Staff / owner
 * only, one specific order, rate-limited per order and per user, audited
 * (requested_by_user_id) with a fresh `resend:<uuid>` idempotency key.
 */
export async function resendForOrder(store: DataStore, auth: CustomerAuthProvider, actor: Actor, orderId: string, kind: ResendKind) {
  if (actor.role !== "staff" && actor.role !== "owner") throw new DomainError("FORBIDDEN", "Only staff or the owner can resend customer emails.");
  const db = store.elevated();
  const o = await db.getOrder(orderId);
  if (!o) throw new DomainError("NOT_FOUND", "Order not found.");
  const okOrder = await db.hitRateLimit(`resend:order:${orderId}`, RESEND_LIMITS.perOrder.windowS, RESEND_LIMITS.perOrder.max);
  const okUser = await db.hitRateLimit(`resend:user:${actor.id}`, RESEND_LIMITS.perUser.windowS, RESEND_LIMITS.perUser.max);
  if (!okOrder || !okUser) throw new DomainError("RATE_LIMITED", "Too many resends for this order. Please wait before trying again.");
  if (kind === "quote_review") {
    if (o.status !== "Waiting for Confirmation") throw new DomainError("VALIDATION", "Only an order waiting for the customer's acceptance has a quotation link.");
    const r = await issueReviewLink(db, orderId, { requestedBy: actor.id });
    return { delivery: r.status };
  }
  if (o.status === "Quote Requested" || o.status === "Waiting for Confirmation" || !o.approved_revision_number || !o.specs_confirmed)
    throw new DomainError("VALIDATION", "Account emails are sent only after the customer has accepted the quotation.");
  if (!o.email_verified_at || !o.customer_email || o.has_no_email)
    throw new DomainError("VALIDATION", "The customer's email is not verified for this order yet.");
  const r = await provisionCustomerAccount(db, auth, orderId, { requestedBy: actor.id });
  const mine = (await db.listOutbox({ orderId })).filter((x) => x.requested_by_user_id === actor.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const delivery = mine?.delivery_status === "sent" ? "sent" : mine?.delivery_status === "failed" || r.status === "failed" ? "failed" : "pending";
  return { delivery, provisioning: r.status };
}
