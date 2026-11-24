import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DEMO_CUSTOMER_LOGIN } from "@/lib/data/seed";
import { DomainError } from "@/lib/domain/errors";
import type { Actor } from "@/lib/domain/types";
import { decryptPayload, encryptPayload, loadKeyring, OutboxDecryptError, OutboxKeyError } from "@/lib/email/crypto";
import { gmailProvider, mailConfig, resendProvider, sanitizeError, type MailProvider, type OutgoingEmail, type SendOutcome } from "@/lib/email/mailer";
import { enqueueEmail, processOutbox } from "@/lib/email/outbox";
import { requestSetupLink, resendForOrder, SETUP_LINK_GENERIC, SETUP_LINK_RATE_LIMITED } from "@/lib/email/requests";
import { renderEmail } from "@/lib/email/templates";
import { cronAuthorized } from "@/lib/server/request-meta";
import { demoCustomerAuth, sha256, type CustomerAuthProvider } from "@/lib/services/customer-auth";
import { acceptFromReview, issueReviewLink, openReviewLink } from "@/lib/services/customer-portal";
import { createOrder } from "@/lib/services/orders";
import { actors, seededStore, validOrderInput, readyForAcceptance } from "./helpers";

const b64key = () => randomBytes(32).toString("base64");
const err = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as Error; }
  throw new Error("expected an error");
};

/** Scriptable provider that records every call. */
function fakeProvider(outcomes: SendOutcome[]): MailProvider & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    name: "resend",
    calls,
    async send(msg) {
      calls.push(msg);
      return outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    },
  };
}
const accepted = (id = "msg-1"): SendOutcome => ({ kind: "accepted", providerMessageId: `resend:${id}` });
const timeout: SendOutcome = { kind: "retry", error: "Resend request did not complete (TimeoutError)" };
const due = (store: MemoryStore) => { for (const o of store.t.notification_outbox) o.next_retry_at = new Date(Date.now() - 1000).toISOString(); };

/** A confirmed + quoted order with an explicitly sent review link (no longer sent automatically since migration 009). */
async function emailOrder(email = "outbox.buyer@example.com") {
  const store = (await seededStore()) as MemoryStore;
  const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: email, furniture_price: "20000" }));
  await readyForAcceptance(store, order.id);
  await issueReviewLink(store, order.id);
  return { store, order: (await store.getOrder(order.id))!, email };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// -------------------------------------------------------------- 1. crypto ----
describe("1. AES-256-GCM envelope & key handling", () => {
  it("fails closed: missing or malformed keys throw, there is no plaintext fallback outside demo", () => {
    expect(() => loadKeyring({}, false)).toThrow(OutboxKeyError);
    expect(() => loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: "not base64!!" }, false)).toThrow(/base64/);
    expect(() => loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: randomBytes(16).toString("base64") }, false)).toThrow(/exactly 32 bytes/);
    expect(loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: b64key() }, false).current.key.length).toBe(32);
  });
  it("a fresh 12-byte IV per encryption, 16-byte tag, no plaintext in the envelope", () => {
    const ring = loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: b64key() }, false);
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const env = JSON.parse(encryptPayload({ token: "RAW-SECRET-TOKEN" }, "k", ring));
      expect(Buffer.from(env.iv, "base64")).toHaveLength(12);
      expect(Buffer.from(env.tag, "base64")).toHaveLength(16);
      expect(JSON.stringify(env)).not.toContain("RAW-SECRET-TOKEN");
      ivs.add(env.iv);
    }
    expect(ivs.size).toBe(200);
  });
  it("tampered tag, ciphertext or a different row (AAD) fail authentication", () => {
    const ring = loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: b64key() }, false);
    const stored = encryptPayload({ token: "abc" }, "quote_review:1", ring);
    expect(decryptPayload<{ token: string }>(stored, "quote_review:1", ring).token).toBe("abc");
    const env = JSON.parse(stored);
    const flip = (b64: string) => { const b = Buffer.from(b64, "base64"); b[0] ^= 1; return b.toString("base64"); };
    expect(() => decryptPayload(JSON.stringify({ ...env, tag: flip(env.tag) }), "quote_review:1", ring)).toThrow(OutboxDecryptError);
    expect(() => decryptPayload(JSON.stringify({ ...env, ct: flip(env.ct) }), "quote_review:1", ring)).toThrow(OutboxDecryptError);
    expect(() => decryptPayload(stored, "quote_review:OTHER-ORDER", ring)).toThrow(OutboxDecryptError); // cannot be moved to another row
  });
  it("key rotation: envelopes made with the previous key stay readable; a removed key is a config error", () => {
    const oldK = b64key(), newK = b64key();
    const before = encryptPayload({ token: "t1" }, "a", loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: oldK }, false));
    const rotated = loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: newK, OUTBOX_TOKEN_ENCRYPTION_KEYS_PREVIOUS: oldK }, false);
    expect(decryptPayload<{ token: string }>(before, "a", rotated).token).toBe("t1");
    expect(JSON.parse(encryptPayload({ x: 1 }, "a", rotated)).v).toBe(rotated.current.id); // new writes use the new key
    expect(() => decryptPayload(before, "a", loadKeyring({ OUTBOX_TOKEN_ENCRYPTION_KEY: newK }, false))).toThrow(OutboxKeyError);
  });
  it("production without a key: queuing a review link fails closed (no outbox row, nothing in plaintext)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_MODE", "production");
    vi.stubEnv("OUTBOX_TOKEN_ENCRYPTION_KEY", "");
    vi.resetModules();
    const { enqueueEmail: enq } = await import("@/lib/email/outbox");
    const { seededStore: seed } = await import("./helpers");
    const store = (await seed()) as MemoryStore;
    const e = await err(enq(store, { kind: "quote_review_ready", order_id: null, recipient_email: "a@example.com", template_data: {}, idempotency_key: "k", secret: { token: "RAW" } }));
    expect(e.name).toBe("OutboxKeyError");
    expect(store.t.notification_outbox).toHaveLength(0);
  });
});

// --------------------------------------------------- 2. leases / stale worker ----
describe("2. lease ownership", () => {
  it("worker A stalls past its lease; worker B re-claims; A's late result changes nothing", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { row } = await enqueueEmail(store, { kind: "account_setup_link", order_id: null, recipient_email: "lease@example.com", customer_user_id: null, template_data: {}, idempotency_key: "setup:lease" });
    const [a] = await store.claimOutbox(10, 60, row.id);
    expect(await store.claimOutbox(10, 60, row.id)).toHaveLength(0); // actively leased
    store.t.notification_outbox[0].processing_lease_until = new Date(Date.now() - 1000).toISOString(); // A stalled
    const [b] = await store.claimOutbox(10, 60, row.id);
    expect(b.processing_lease_token).not.toBe(a.processing_lease_token);
    expect(b.attempt_count).toBe(2);
    expect(await store.completeOutbox(row.id, a.processing_lease_token!, "stale-A")).toBe(false);
    expect(await store.failOutbox(row.id, a.processing_lease_token!, "stale", true, 60)).toBe(false);
    expect(await store.completeOutbox(row.id, b.processing_lease_token!, "resend:B")).toBe(true);
    const final = (await store.getOutbox(row.id))!;
    expect(final).toMatchObject({ delivery_status: "sent", provider_message_id: "resend:B", processing_lease_token: null, encrypted_payload: null });
  });
});

// ------------------------------------- 3. ambiguous timeout vs. duplicates ----
describe("3. retries after an ambiguous timeout", () => {
  it("quotation email: same idempotency key on every automatic retry; token encrypted until sent, then scrubbed", async () => {
    const { store, order, email } = await emailOrder();
    // the immediate attempt went to the demo inbox; queue a manual resend and drive it with a flaky provider
    const r = await issueReviewLink(store, order.id, { requestedBy: actors.staff.id });
    const row = store.t.notification_outbox.find((o) => o.id === r.outbox_id)!;
    expect(row.idempotency_key).toMatch(/^resend:[0-9a-f-]{36}$/);
    expect(row.requested_by_user_id).toBe(actors.staff.id);
    // the manual resend went to the demo inbox; its token is the open one. Drive an automatic row with a flaky provider.
    const raw = store.t.demo_mailbox.find((m) => m.to === email)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const tok = store.t.quote_review_tokens.find((t) => t.token_hash === sha256(raw))!;
    const p = fakeProvider([timeout, timeout, accepted("q1")]);
    const { row: auto } = await enqueueEmail(store, {
      kind: "quote_review_ready", order_id: order.id, recipient_email: email, review_token_id: tok.token_id,
      template_data: { order_code: order.order_code }, idempotency_key: "quote_review:auto-test", secret: { token: raw },
    });
    expect(auto.encrypted_payload).not.toContain(raw);
    for (let i = 0; i < 3; i++) { due(store); await processOutbox(store, { provider: p }, { onlyId: auto.id }); }
    expect(p.calls.map((c) => c.idempotencyKey)).toEqual(["quote_review:auto-test", "quote_review:auto-test", "quote_review:auto-test"]);
    expect(p.calls[2].text).toBe(p.calls[0].text);
    const after = (await store.getOutbox(auto.id))!;
    expect(after).toMatchObject({ delivery_status: "sent", provider_message_id: "resend:q1", encrypted_payload: null, attempt_count: 3 });
    expect(JSON.stringify(store.t.notification_outbox)).not.toContain(raw);
    // a placeholder that does not match the stored SHA-256 hash is never sent
    const { row: bogus } = await enqueueEmail(store, { kind: "quote_review_ready", order_id: order.id, recipient_email: email, review_token_id: tok.token_id,
      template_data: {}, idempotency_key: "quote_review:bogus", secret: { token: "not-the-token" } });
    await processOutbox(store, { provider: p }, { onlyId: bogus.id });
    expect(p.calls).toHaveLength(3);
    expect((await store.getOutbox(bogus.id))!).toMatchObject({ is_permanent_failure: true, encrypted_payload: null });
  });

  it("new-customer confirmation: retries reuse the SAME encrypted set-up link; no duplicate accounts or confirmations", async () => {
    const { store, order, email } = await emailOrder("timeout.buyer@example.com");
    const reviewRaw = store.t.demo_mailbox.find((m) => m.to === email)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const scope = await openReviewLink(store, reviewRaw);
    const base = demoCustomerAuth(store);
    let links = 0;
    const auth: CustomerAuthProvider = { ...base, passwordLink: async (...a) => { links++; return base.passwordLink(...a); } };
    await acceptFromReview(store, auth, scope, { accepted_furniture_price: 20000, accepted_delivery_fee: 0, client_idempotency_key: crypto.randomUUID(), accept_specification: true, accept_quotation: true });
    const acct = store.t.customer_accounts.find((a) => a.email === email)!;
    const accountsBefore = store.t.customer_accounts.length;
    const confirmationsBefore = store.t.order_confirmations.length;
    links = 0;
    // an automatic confirmation email whose first two provider calls time out (outcome unknown)
    const { row } = await enqueueEmail(store, { kind: "order_confirmed_new_customer", order_id: order.id, recipient_email: email, customer_user_id: acct.id,
      template_data: { order_code: order.order_code }, idempotency_key: `order_confirmed_new:${order.id}:retry-test` });
    const p = fakeProvider([timeout, timeout, accepted("n1")]);
    for (let i = 0; i < 3; i++) { due(store); await processOutbox(store, { provider: p, auth }, { onlyId: row.id }); }
    expect(new Set(p.calls.map((c) => c.idempotencyKey))).toEqual(new Set([row.idempotency_key]));
    expect(p.calls[1].html).toBe(p.calls[0].html); // identical payload => Resend de-duplicates; the customer's link stays valid
    expect(p.calls[2].text).toBe(p.calls[0].text);
    expect(links).toBe(1); // ONE set-up link generated for all three attempts
    const done = (await store.getOutbox(row.id))!;
    expect(done).toMatchObject({ delivery_status: "sent", provider_message_id: "resend:n1", encrypted_payload: null });
    expect(store.t.customer_accounts.length).toBe(accountsBefore);
    expect(store.t.order_confirmations.length).toBe(confirmationsBefore);
    expect(JSON.stringify(store.t.notification_outbox)).not.toMatch(/token=/);
    expect(JSON.stringify(store.t.notifications)).not.toMatch(/token=/);
  });

  it("a staff resend gets a NEW uuid key and is audited", async () => {
    const { store, order } = await emailOrder("resend.buyer@example.com");
    await resendForOrder(store, demoCustomerAuth(store), actors.staff, order.id, "quote_review");
    await resendForOrder(store, demoCustomerAuth(store), actors.owner, order.id, "quote_review");
    const manual = store.t.notification_outbox.filter((o) => o.order_id === order.id && o.idempotency_key.startsWith("resend:"));
    expect(manual).toHaveLength(2);
    expect(manual[0].idempotency_key).not.toBe(manual[1].idempotency_key);
    expect(manual.map((m) => m.requested_by_user_id)).toEqual([actors.staff.id, actors.owner.id]);
  });

  it("no provider configured: rows stay pending and are never reported as sent", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { row } = await enqueueEmail(store, { kind: "account_setup_link", order_id: null, recipient_email: "none@example.com", customer_user_id: null, template_data: {}, idempotency_key: "setup:none" });
    const s = await processOutbox(store, { provider: null });
    expect(s).toMatchObject({ provider: "none", claimed: 0, sent: 0 });
    expect((await store.getOutbox(row.id))!.delivery_status).toBe("pending");
    expect(mailConfig({}, false)).toMatchObject({ provider: "none" });
  });
});

// ---------------------------------------------------- provider classification ----
describe("providers", () => {
  it("Resend: Idempotency-Key header; 2xx accepted, 422 permanent, 429 / 5xx / timeout / concurrent-409 retry", async () => {
    const seen: Headers[] = [];
    const res = (status: number, body: object) => async (_u: unknown, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return new Response(JSON.stringify(body), { status }); };
    const msg = { to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t", idempotencyKey: "quote_review:xyz" };
    expect(await resendProvider("k", "JJ <x@jj.example>", res(200, { id: "e1" }) as typeof fetch).send(msg)).toEqual({ kind: "accepted", providerMessageId: "resend:e1" });
    expect(seen[0].get("idempotency-key")).toBe("quote_review:xyz");
    expect((await resendProvider("k", "f", res(422, { name: "validation_error", message: "Invalid `to` field" }) as typeof fetch).send(msg)).kind).toBe("permanent");
    expect((await resendProvider("k", "f", res(429, {}) as typeof fetch).send(msg)).kind).toBe("retry");
    expect((await resendProvider("k", "f", res(503, {}) as typeof fetch).send(msg)).kind).toBe("retry");
    expect((await resendProvider("k", "f", res(409, { name: "concurrent_idempotent_requests" }) as typeof fetch).send(msg)).kind).toBe("retry");
    const boom = (async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }) as typeof fetch;
    expect((await resendProvider("k", "f", boom).send(msg)).kind).toBe("retry");
  });
  it("Gmail SMTP: From is the Gmail account; 550 permanent, 535 / timeouts retry", async () => {
    let opts: Record<string, unknown> = {};
    const sent: Record<string, unknown>[] = [];
    const mk = (fail?: object) => (o: object) => { opts = o as Record<string, unknown>; return { sendMail: async (m: Record<string, unknown>) => { sent.push(m); if (fail) throw Object.assign(new Error("smtp"), fail); return { messageId: "<id@gmail>" }; } } as never; };
    const msg = { to: "a@example.com", subject: "s", html: "h", text: "t", idempotencyKey: "k" };
    expect(await gmailProvider("shop@gmail.com", "abcdabcdabcdabcd", "JJ Furniture", mk()).send(msg)).toEqual({ kind: "accepted", providerMessageId: "gmail:<id@gmail>" });
    expect(opts).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true });
    expect(typeof opts.connectionTimeout).toBe("number");
    expect(sent[0].from).toEqual({ name: "JJ Furniture", address: "shop@gmail.com" });
    expect((await gmailProvider("u@gmail.com", "p", "JJ", mk({ responseCode: 550 })).send(msg)).kind).toBe("permanent");
    expect((await gmailProvider("u@gmail.com", "p", "JJ", mk({ responseCode: 535 })).send(msg)).kind).toBe("retry");
    expect((await gmailProvider("u@gmail.com", "p", "JJ", mk({ code: "ETIMEDOUT" })).send(msg)).kind).toBe("retry");
  });
  it("config validation (no secret values echoed)", () => {
    expect(mailConfig({ RESEND_API_KEY: "re_x", EMAIL_FROM: "JJ Furniture <orders@jj.example>" }, false).provider).toBe("resend");
    expect(mailConfig({ GMAIL_SMTP_USER: "shop@gmail.com", GMAIL_SMTP_APP_PASSWORD: "abcd efgh ijkl mnop" }, false).provider).toBe("gmail");
    const bad = mailConfig({ GMAIL_SMTP_USER: "shop@gmail.com", GMAIL_SMTP_APP_PASSWORD: "short" }, false);
    expect(bad.provider).toBe("none");
    expect(bad.problems.join(" ")).not.toContain("short");
  });
});

// ---------------------------------------------- 4. endpoint authorization ----
describe("4. endpoint separation & enumeration safety", () => {
  it("cron endpoint: only the exact Bearer CRON_SECRET; a short / missing secret disables it", () => {
    const secret = "s".repeat(40);
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe("ok");
    expect(cronAuthorized(null, secret)).toBe("unauthorized"); // a staff cookie session sends no bearer
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe("unauthorized");
    expect(cronAuthorized(`Basic ${secret}`, secret)).toBe("unauthorized");
    expect(cronAuthorized(`Bearer ${secret}`, "too-short")).toBe("disabled");
    expect(cronAuthorized(`Bearer x`, undefined)).toBe("disabled");
  });
  it("resend: staff / owner only, per-order rate limit", async () => {
    const { store, order } = await emailOrder("limit.buyer@example.com");
    const auth = demoCustomerAuth(store);
    for (const who of [actors.craftsman, actors.driver, { id: "c1", role: "customer", full_name: "C", source: "demo" } as unknown as Actor]) {
      expect(((await err(resendForOrder(store, auth, who, order.id, "quote_review"))) as DomainError).code).toBe("FORBIDDEN");
    }
    for (let i = 0; i < 5; i++) await resendForOrder(store, auth, actors.staff, order.id, "quote_review");
    expect(((await err(resendForOrder(store, auth, actors.staff, order.id, "quote_review"))) as DomainError).code).toBe("RATE_LIMITED");
  });
  it("request-setup-link: identical answer for registered / unregistered / invalid; never creates accounts; only eligible accounts get a link", async () => {
    const store = (await seededStore()) as MemoryStore;
    const auth = demoCustomerAuth(store);
    const tasks: (() => Promise<unknown>)[] = [];
    const ask = (email: unknown, ip = "1.2.3.4") => requestSetupLink(store, auth, { email, clientIp: ip }, (t) => tasks.push(t));
    const accounts = store.t.customer_accounts.length;
    const answers = [await ask(DEMO_CUSTOMER_LOGIN.email, "10.0.0.1"), await ask("nobody@example.com", "10.0.0.2"), await ask("not-an-email", "10.0.0.3"), await ask(" Maria.Santos@Example.com ", "10.0.0.4")];
    expect(answers.every((a) => a.status === 200 && a.message === SETUP_LINK_GENERIC)).toBe(true);
    for (const t of tasks) await t();
    expect(store.t.customer_accounts.length).toBe(accounts);
    const links = store.t.notification_outbox.filter((o) => o.kind === "account_setup_link");
    expect(links.map((l) => l.recipient_email)).toEqual([DEMO_CUSTOMER_LOGIN.email, DEMO_CUSTOMER_LOGIN.email]); // normalized; nobody@ got nothing
    expect(links.every((l) => l.idempotency_key.startsWith("setup:"))).toBe(true);
  });
  it("request-setup-link: rate-limited per email (HMAC bucket) and per IP — same answer either way", async () => {
    const store = (await seededStore()) as MemoryStore;
    const auth = demoCustomerAuth(store);
    const ask = (email: string, ip: string) => requestSetupLink(store, auth, { email, clientIp: ip }, () => {});
    for (let i = 0; i < 3; i++) expect((await ask("x@example.com", `9.9.9.${i}`)).status).toBe(200);
    expect(await ask("x@example.com", "9.9.9.200")).toEqual({ status: 429, message: SETUP_LINK_RATE_LIMITED });
    for (let i = 0; i < 10; i++) await ask(`u${i}@example.com`, "7.7.7.7");
    expect((await ask("fresh@example.com", "7.7.7.7")).status).toBe(429);
    expect(JSON.stringify(store.t.rate_limit_hits)).not.toContain("example.com"); // buckets hold an HMAC, never the address
  });
});

// ------------------------------------------------- 6. templates / logs ----
describe("6. templates and log hygiene", () => {
  it("templates escape customer data and carry the right call to action", () => {
    const d = { customer_name: '<script>alert("x")</script>', order_code: "JJ-2026-0150", item_summary: "Table", total: "₱20,000", down_payment: "₱6,000" };
    const q = renderEmail("quote_review_ready", d, "https://jj.example/customer/review?token=abc");
    expect(q.html).not.toContain("<script>");
    expect(q.html).toContain("&lt;script&gt;");
    expect(q.html).toContain("Review &amp; Accept Quotation");
    expect(renderEmail("order_confirmed_new_customer", d, "https://x").html).toContain("Create Your Password");
    expect(renderEmail("order_confirmed_returning_customer", d, "https://x/login").html).toContain("Log In to Your Account");
    const pay = renderEmail("quotation_payment_request", d, "https://x/customer/orders/JJ-2026-0150");
    expect(pay.html).toContain("Review Quotation &amp; Pay");
    expect(pay.text).toMatch(/30% down payment, installment or full payment/);
    expect(pay.html).not.toContain("<script>");
    for (const c of ["#2B1D17", "#6B4A3A", "#C48A5A", "#FAF6F0"]) expect(q.html).toContain(c);
  });
  it("sanitized errors never contain links, tokens or addresses", () => {
    const s = sanitizeError(new Error("POST https://x.supabase.co/auth/v1/verify?token=abcdefabcdefabcdefabcdefabcdefabcdef failed for maria@example.com"));
    expect(s).not.toMatch(/https?:|token=|@example\.com|abcdefabcdef/);
  });
  it("a consumed review link is never sent from the queue (reused / cross-order tokens are rejected)", async () => {
    const { store, order, email } = await emailOrder("reuse.buyer@example.com");
    const raw = store.t.demo_mailbox.find((m) => m.to === email)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const tok = store.t.quote_review_tokens.find((t) => t.token_hash === sha256(raw))!;
    const { row } = await enqueueEmail(store, { kind: "quote_review_ready", order_id: order.id, recipient_email: email, review_token_id: tok.token_id, template_data: {}, idempotency_key: "quote_review:reuse", secret: { token: raw } });
    await openReviewLink(store, raw); // consumed
    expect((await store.getOutbox(row.id))!).toMatchObject({ encrypted_payload: null, is_permanent_failure: true });
    expect(((await err(openReviewLink(store, raw))) as DomainError).message).toMatch(/already used/);
    const p = fakeProvider([accepted()]);
    due(store);
    await processOutbox(store, { provider: p }, { onlyId: row.id });
    expect(p.calls).toHaveLength(0);
  });
});

describe("review fixes", () => {
  it("client IP for rate limits ignores a spoofed left-most X-Forwarded-For entry", async () => {
    const { pickClientIp } = await import("@/lib/server/request-meta");
    expect(pickClientIp("6.6.6.6, 203.0.113.7", null, 1)).toBe("203.0.113.7");
    expect(pickClientIp("6.6.6.6, 203.0.113.7, 10.0.0.2", null, 2)).toBe("203.0.113.7");
    expect(pickClientIp(null, "198.51.100.4", 1)).toBe("198.51.100.4");
  });
  it("account-setup resend is refused until the shop has confirmed the order", async () => {
    const store = (await seededStore()) as MemoryStore;
    const email = "notyet.buyer@example.com";
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: email, furniture_price: "20000" }));
    expect(((await err(resendForOrder(store, demoCustomerAuth(store), actors.staff, order.id, "account_setup"))) as DomainError).code).toBe("VALIDATION");
    expect(store.t.customer_accounts.some((a) => a.email === email)).toBe(false);
    await readyForAcceptance(store, order.id);
    await resendForOrder(store, demoCustomerAuth(store), actors.staff, order.id, "account_setup");
    expect(store.t.customer_accounts.filter((a) => a.email === email)).toHaveLength(1); // a password-less login + set-up email
    expect((await store.getOrder(order.id))!.customer_user_id).toBeNull(); // linked only once the inbox owner signs in
  });
  it("a delayed (cron) delivery of the set-up email updates the order's account status", async () => {
    const { store, order, email } = await emailOrder("late.buyer@example.com");
    const raw = store.t.demo_mailbox.find((m) => m.to === email)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const scope = await openReviewLink(store, raw);
    const auth = demoCustomerAuth(store);
    await acceptFromReview(store, auth, scope, { accepted_furniture_price: 20000, accepted_delivery_fee: 0, client_idempotency_key: crypto.randomUUID(), accept_specification: true, accept_quotation: true });
    const row = store.t.notification_outbox.find((o) => o.kind === "order_confirmed_new_customer" && o.order_id === order.id)!;
    // pretend the immediate attempt failed and the order is waiting
    Object.assign(row, { delivery_status: "failed", provider_message_id: null, sent_at: null, next_retry_at: new Date(Date.now() - 1000).toISOString() });
    await store.updateOrder(order.id, { provisioning_status: "setup_email_pending" });
    await processOutbox(store, { provider: fakeProvider([accepted("late")]), auth }, { onlyId: row.id });
    expect((await store.getOrder(order.id))!.provisioning_status).toBe("setup_email_sent");
  });
});
