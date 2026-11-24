import { describe, expect, it } from "vitest";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DEMO_CUSTOMER_LOGIN } from "@/lib/data/seed";
import { DomainError } from "@/lib/domain/errors";
import { demoCompletePassword, demoCustomerAuth, demoVerifyPassword, sha256, type CustomerAuthProvider } from "@/lib/services/customer-auth";
import {
  acceptFromReview,
  customerDashboard,
  customerOwnedOrder,
  issueReviewLink,
  openReviewLink,
  provisionCustomerAccount,
  reviewView,
} from "@/lib/services/customer-portal";
import { createOrder, editOrderDetails, reviseSpecs, startProduction } from "@/lib/services/orders";
import { actors, payDown, readyForAcceptance, seededStore, staffAccept, validOrderInput } from "./helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("expected an error");
};

const mailbox = (store: MemoryStore, to: string) => store.t.demo_mailbox.filter((m) => m.to === to);
const linkIn = (text: string, path: string) => {
  const m = text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!m) throw new Error(`no ${path} link in: ${text}`);
  return m[1];
};
const lastReviewToken = (store: MemoryStore, to: string) => linkIn(mailbox(store, to)[0].text, "/customer/review");

/**
 * The single-use review link (migration 005) is no longer sent automatically: since
 * migration 009 the customer accepts while signed in. It stays available as an
 * explicit staff resend, which these tests exercise on a confirmed + quoted order.
 */
async function emailOrder(email = "new.buyer@example.com") {
  const store = (await seededStore()) as MemoryStore;
  const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: email, furniture_price: "20000" }));
  await readyForAcceptance(store, order.id);
  await issueReviewLink(store, order.id);
  return { store, order: (await store.getOrder(order.id))!, email };
}
const acceptInput = (price = 20000, fee = 0) => ({
  accepted_furniture_price: price, accepted_delivery_fee: fee, client_idempotency_key: crypto.randomUUID(),
  accept_specification: true, accept_quotation: true,
});

describe("Step 1 — email capture and scoped review links", () => {
  it("issuing a quotation emails a single-use link; only its SHA-256 hash is stored and the log never contains it", async () => {
    const { store, order, email } = await emailOrder();
    const raw = lastReviewToken(store, email);
    expect(raw.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    const rows = store.t.quote_review_tokens.filter((t) => t.order_id === order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha256(raw));
    expect(JSON.stringify(store.t.quote_review_tokens)).not.toContain(raw);
    const all = (await store.listNotifications(order.id)).filter((n) => n.channel === "Email");
    expect(all.map((n) => n.delivery_status).sort()).toEqual(["Pending", "Sent"]); // queued, then accepted
    for (const n of all) expect(n.message_body).not.toContain(raw);
    const log = all.filter((n) => n.delivery_status === "Sent");
    expect(log.length).toBe(1);
    expect(log[0].message_body).not.toContain(raw);
    expect(log[0].message_body).toContain("[secure link — not stored]");
    expect((await store.getOrder(order.id))!.email_verified_at).toBeNull(); // unverified until the link is opened
  });

  it("walk-in orders (paper slip only) get no link, no email and no portal", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: "", has_no_email: "on" }));
    expect(order.has_no_email).toBe(true);
    expect(order.provisioning_status).toBe("not_applicable");
    expect(store.t.quote_review_tokens.some((t) => t.order_id === order.id)).toBe(false);
    expect((await err(issueReviewLink(store, order.id))).code).toBe("VALIDATION");
    // both or neither is refused
    expect((await err(createOrder(store, actors.staff, validOrderInput({ customer_email: "", has_no_email: "" })))).code).toBe("VALIDATION");
    expect((await err(createOrder(store, actors.staff, validOrderInput({ customer_email: "a@example.com", has_no_email: "on" })))).code).toBe("VALIDATION");
  });

  it("opening the link consumes it once, verifies that inbox for this order, and scopes the session to one order + revision", async () => {
    const { store, order, email } = await emailOrder();
    const raw = lastReviewToken(store, email);
    const scope = await openReviewLink(store, raw);
    expect(scope.order_id).toBe(order.id);
    expect(scope.revision_id).toBe((await store.listRevisions(order.id)).find((r) => r.revision_number === order.current_revision)!.revision_id);
    expect((await store.getOrder(order.id))!.email_verified_at).toBeTruthy();
    expect((await err(openReviewLink(store, raw))).message).toMatch(/already used/); // replay
    expect((await err(openReviewLink(store, "not-a-real-token-but-long-enough"))).message).toMatch(/not valid/);
  });

  it("concurrent opens of the same link: exactly one succeeds", async () => {
    const { store, email } = await emailOrder();
    const raw = lastReviewToken(store, email);
    const results = await Promise.allSettled([openReviewLink(store, raw), openReviewLink(store, raw), openReviewLink(store, raw)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("expired links, superseded quotations and changed emails are refused", async () => {
    const { store, order, email } = await emailOrder();
    const first = lastReviewToken(store, email);
    // a revised quote invalidates the earlier link; staff send a fresh one
    await reviseSpecs(store, actors.staff, order.id, { ...validOrderInput(), furniture_price: "21000" }, 2);
    expect((await err(openReviewLink(store, first))).message).toMatch(/newer quotation/);
    await issueReviewLink(store, order.id);
    const second = lastReviewToken(store, email);
    store.t.quote_review_tokens.find((t) => t.token_hash === sha256(second))!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await err(openReviewLink(store, second))).message).toMatch(/expired/);
    // re-issue, then the email changes before it is opened
    await issueReviewLink(store, order.id);
    const third = lastReviewToken(store, email);
    const o = (await store.getOrder(order.id))!;
    await editOrderDetails(store, actors.staff, order.id, {
      customer_email: "other.inbox@example.com", has_no_email: "", customer_phone: o.customer_phone, delivery_address: o.delivery_address,
      municipality: o.municipality, delivery_fee: o.delivery_fee, estimated_completion_date: o.estimated_completion_date, scheduled_delivery_date: "",
    });
    expect((await err(openReviewLink(store, third))).message).toMatch(/email on this order changed|newer quotation/);
    const after = (await store.getOrder(order.id))!;
    expect(after.email_verified_at).toBeNull();
    expect(after.customer_user_id).toBeNull();
    expect(mailbox(store, "other.inbox@example.com")).toHaveLength(0); // nothing is sent automatically to an edited email
    await issueReviewLink(store, order.id);
    expect(mailbox(store, "other.inbox@example.com")).toHaveLength(1); // the new inbox gets its own link on request
  });
});

describe("Step 2 — acceptance first, then recoverable provisioning", () => {
  it("new customer: acceptance via accept_order_revision, then a password-less account, link, and a set-up email", async () => {
    const { store, order, email } = await emailOrder();
    const scope = await openReviewLink(store, lastReviewToken(store, email));
    const auth = demoCustomerAuth(store);
    const { order: accepted, provisioning } = await acceptFromReview(store, auth, scope, acceptInput());
    expect(accepted.status).toBe("Confirmed");
    const [c] = await store.listConfirmations(order.id);
    expect(c.revision_id).toBe(scope.revision_id);
    expect(c.specification_accepted_at).toBeTruthy();
    expect(provisioning.status).toBe("setup_email_sent");
    const acct = store.t.customer_accounts.find((a) => a.email === email)!;
    expect(acct.password_hash).toBeNull(); // never a plaintext / generated password
    const o = (await store.getOrder(order.id))!;
    expect(o.customer_user_id).toBe(acct.id);
    expect(o.provisioning_status).toBe("setup_email_sent");
    // the set-up link works once and sets a bcrypt password
    const setup = linkIn(mailbox(store, email)[0].text, "/customer/set-password");
    expect(store.t.password_tokens.some((t) => t.token_hash === sha256(setup))).toBe(true);
    expect((await err(demoCompletePassword(store, setup, "short"))).code).toBe("VALIDATION");
    await demoCompletePassword(store, setup, "Mahogany-Chair-77");
    expect((await err(demoCompletePassword(store, setup, "Another-Strong-88"))).message).toMatch(/invalid or has expired/);
    expect((await demoVerifyPassword(store, email, "Mahogany-Chair-77")).user_id).toBe(acct.id);
    expect((await err(demoVerifyPassword(store, email, "wrong-password-1"))).message).toBe("Email or password is incorrect.");
    expect((await err(demoVerifyPassword(store, "nobody@example.com", "x"))).message).toBe("Email or password is incorrect."); // no enumeration
    // the customer dashboard shows exactly this order
    const dash = await customerDashboard(store, acct.id);
    expect(dash.map((d) => d.view.order_code)).toEqual([o.order_code]);
  });

  it("the review session can accept ONLY its scoped revision, even if the browser sends other values", async () => {
    const { store, order, email } = await emailOrder();
    const scope = await openReviewLink(store, lastReviewToken(store, email));
    // staff revise the quote after the customer opened the link: the scoped revision is now stale
    await reviseSpecs(store, actors.staff, order.id, { ...validOrderInput(), furniture_price: "25000" }, 2);
    const view = await reviewView(store, scope);
    expect(view.scope_current).toBe(false);
    expect((await err(acceptFromReview(store, demoCustomerAuth(store), scope, acceptInput(25000)))).code).toBe("STALE_REVISION");
    expect((await err(acceptFromReview(store, demoCustomerAuth(store), scope, acceptInput(20000)))).code).toBe("STALE_REVISION");
    expect(await store.listConfirmations(order.id)).toHaveLength(0);
  });

  it("returning customer: the order is linked, the password is NOT reset, and a log-in email is sent", async () => {
    const store = (await seededStore()) as MemoryStore;
    const maria = store.t.customer_accounts.find((a) => a.email === DEMO_CUSTOMER_LOGIN.email)!;
    const before = maria.password_hash;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: DEMO_CUSTOMER_LOGIN.email, furniture_price: "15000" }));
    await readyForAcceptance(store, order.id);
    await issueReviewLink(store, order.id);
    const scope = await openReviewLink(store, lastReviewToken(store, DEMO_CUSTOMER_LOGIN.email));
    const { provisioning } = await acceptFromReview(store, demoCustomerAuth(store), scope, acceptInput(15000));
    expect(provisioning).toMatchObject({ status: "linked", new_account: false });
    expect(store.t.customer_accounts.filter((a) => a.email === DEMO_CUSTOMER_LOGIN.email)).toHaveLength(1);
    expect(maria.password_hash).toBe(before);
    expect(store.t.password_tokens.filter((t) => t.user_id === maria.id)).toHaveLength(0);
    expect(mailbox(store, DEMO_CUSTOMER_LOGIN.email)[0].text).toMatch(/Your password was not changed/);
    const codes = (await customerDashboard(store, maria.id)).map((d) => d.view.order_code);
    expect(codes).toContain("JJ-2026-0145");
    expect(codes).toContain((await store.getOrder(order.id))!.order_code);
  });

  it("an auth / email failure never undoes the committed acceptance; a retry finishes provisioning idempotently", async () => {
    const { store, order, email } = await emailOrder();
    const scope = await openReviewLink(store, lastReviewToken(store, email));
    const broken: CustomerAuthProvider = {
      createAccount: async () => { throw new Error("auth service down"); },
      passwordLink: async () => { throw new Error("auth service down"); },
      hasPassword: async () => false,
      emailVerified: async () => true,
    };
    const { order: accepted, provisioning } = await acceptFromReview(store, broken, scope, acceptInput());
    expect(accepted.status).toBe("Confirmed");
    expect(provisioning.status).toBe("failed");
    expect((await store.getOrder(order.id))!.status).toBe("Confirmed");
    expect(await store.listConfirmations(order.id)).toHaveLength(1);
    // retry (e.g. staff "Retry account set-up"): completes once, repeated calls change nothing
    const auth = demoCustomerAuth(store);
    expect((await provisionCustomerAccount(store, auth, order.id)).status).toBe("setup_email_sent");
    const mails = mailbox(store, email).length;
    expect((await provisionCustomerAccount(store, auth, order.id)).status).toBe("setup_email_sent");
    expect(mailbox(store, email).length).toBe(mails);
    expect(store.t.customer_accounts.filter((a) => a.email === email)).toHaveLength(1);
  });

  it("without verified email ownership nothing is linked (e.g. acceptance recorded at the counter)", async () => {
    const { store, order } = await emailOrder();
    await staffAccept(store, actors.staff, order.id, "Signed Paper Slip");
    const r = await provisionCustomerAccount(store, demoCustomerAuth(store), order.id);
    expect(r.status).toBe("pending");
    expect((await store.getOrder(order.id))!.customer_user_id).toBeNull();
    expect(store.t.customer_accounts.some((a) => a.email === "new.buyer@example.com")).toBe(false);
  });

  it("the approval engine is unchanged: production still needs the verified 30%", async () => {
    const { store, order, email } = await emailOrder();
    const scope = await openReviewLink(store, lastReviewToken(store, email));
    await acceptFromReview(store, demoCustomerAuth(store), scope, acceptInput());
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    await payDown(store, order.id);
    expect((await startProduction(store, actors.staff, order.id)).status).toBe("In Production");
  });
});

describe("Step 4 — the dashboard is limited to the signed-in customer's linked orders", () => {
  it("refuses orders that belong to someone else or are not linked", async () => {
    const store = (await seededStore()) as MemoryStore;
    const maria = store.t.customer_accounts[0];
    await expect(customerOwnedOrder(store, maria.id, "JJ-2026-0145")).resolves.toBeTruthy();
    expect((await err(customerOwnedOrder(store, maria.id, "JJ-2026-0136"))).code).toBe("NOT_FOUND");
    expect((await err(customerOwnedOrder(store, "c0000000-0000-4000-8000-00000000ffff", "JJ-2026-0145"))).code).toBe("NOT_FOUND");
    const view = (await customerDashboard(store, maria.id))[0].view;
    expect(JSON.stringify(view)).not.toMatch(/pin_code|token_hash|password/);
  });
  it("orders cannot be linked or verified through a plain update", async () => {
    const store = (await seededStore()) as MemoryStore;
    const o = (await store.getOrderByCode("JJ-2026-0136"))!;
    const patch = { customer_user_id: store.t.customer_accounts[0].id } as never;
    expect((await err(store.updateOrder(o.id, patch))).code).toBe("FORBIDDEN");
    expect((await err(store.linkCustomerAccount(o.id, store.t.customer_accounts[0].id))).code).toBe("FORBIDDEN");
  });
});
