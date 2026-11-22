import "server-only";
import { randomInt } from "node:crypto";
import type { DataStore } from "@/lib/data/store";
import type { OutboxKindName, OutboxRow } from "@/lib/domain/types";
import type { CustomerAuthProvider } from "@/lib/services/customer-auth";
import { sha256 } from "@/lib/services/customer-auth";
import { siteUrl } from "@/lib/services/email";
import { decryptPayload, encryptPayload, OutboxDecryptError, OutboxKeyError } from "./crypto";
import { LEASE_SECONDS, sanitizeError, selectMailProvider, type MailProvider } from "./mailer";
import { renderEmail, type TemplateData } from "./templates";

/**
 * Transactional email outbox (migration 008).
 *
 *   enqueueEmail()  — called by business flows AFTER their own state is committed. Any
 *                     secret (the raw review token) is AES-256-GCM encrypted first; the
 *                     queue never sees plaintext. Idempotent on idempotency_key.
 *   processOutbox() — claims due rows (commit), THEN talks to the provider, then
 *                     completes / fails the row with its lease token. Never creates
 *                     accounts, confirmations or tokens: retries cannot duplicate them.
 *   kickOutbox()    — processes one freshly queued row right away (best effort).
 */
export interface EnqueueInput {
  kind: OutboxKindName;
  order_id: string | null;
  recipient_email: string;
  customer_user_id?: string | null;
  review_token_id?: string | null;
  template_data: TemplateData;
  idempotency_key: string;
  /** encrypted with the row's idempotency key as AAD */
  secret?: Record<string, unknown> | null;
  requested_by_user_id?: string | null;
}

export async function enqueueEmail(store: DataStore, input: EnqueueInput) {
  const db = store.elevated();
  const encrypted = input.secret ? encryptPayload(input.secret, input.idempotency_key) : null; // throws OutboxKeyError: fail closed
  const res = await db.enqueueOutbox({
    kind: input.kind,
    order_id: input.order_id,
    recipient_email: input.recipient_email.trim().toLowerCase(),
    customer_user_id: input.customer_user_id ?? null,
    review_token_id: input.review_token_id ?? null,
    template_data: input.template_data as Record<string, string | null>,
    idempotency_key: input.idempotency_key,
    encrypted_payload: encrypted,
    requested_by_user_id: input.requested_by_user_id ?? null,
  });
  // staff can see a queued email on the order even while no provider is configured / it is retrying
  if (!res.duplicate) await logHistory(db, res.row, SUBJECT_HINT[input.kind], "Pending", "queued");
  return res;
}
const SUBJECT_HINT: Record<OutboxKindName, string> = {
  quote_review_ready: "Quotation review email",
  order_confirmed_new_customer: "Order confirmed + password set-up email",
  order_confirmed_returning_customer: "Order confirmed email (returning customer)",
  account_setup_link: "Password set-up email",
};

export interface ProcessDeps {
  /** needed for password set-up links (Supabase Auth in production) */
  auth?: CustomerAuthProvider | null;
  /** override for tests; default: the configured provider (null = none configured) */
  provider?: MailProvider | null;
}
export interface ProcessSummary {
  provider: string;
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  released: number;
  scrubbed: number;
}

/** Exponential backoff with jitter: ~1, 2, 4, 8 … minutes, capped at 6 h. */
export function backoffSeconds(attempt: number) {
  const base = Math.min(6 * 3600, 60 * 2 ** Math.max(0, attempt - 1));
  return base + randomInt(0, Math.max(1, Math.floor(base / 4)));
}
/** A set-up link generated for a row is reused on automatic retries while still fresh
 *  (identical payload ⇒ Resend de-duplicates, and the customer never holds a dead link). */
export const LINK_REUSE_MS = 45 * 60_000;

type SetupSecret = { link: string; created_at: number };
type ReviewSecret = { token: string };

/** The secure link for a row, built in memory at send time. Returns null + reason if it can no longer be sent. */
async function linkFor(db: DataStore, row: OutboxRow, deps: ProcessDeps): Promise<{ href: string } | { stop: string }> {
  switch (row.kind) {
    case "quote_review_ready": {
      if (!row.encrypted_payload || !row.review_token_id) return { stop: "review link no longer available" };
      const { token } = decryptPayload<ReviewSecret>(row.encrypted_payload, row.idempotency_key);
      const state = await db.reviewTokenState(row.review_token_id);
      // the stored SHA-256 hash stays the only validation mechanism
      if (!state?.usable || state.token_hash !== sha256(token)) return { stop: "review link no longer valid (consumed, replaced or expired)" };
      return { href: `${siteUrl()}/customer/review?token=${token}` };
    }
    case "order_confirmed_returning_customer":
      return { href: `${siteUrl()}/customer/login` };
    case "order_confirmed_new_customer":
    case "account_setup_link": {
      if (row.encrypted_payload) {
        const s = decryptPayload<SetupSecret>(row.encrypted_payload, row.idempotency_key);
        if (Date.now() - s.created_at < LINK_REUSE_MS) return { href: s.link };
      }
      if (!deps.auth || !row.customer_user_id) return { stop: "no customer account for a set-up link" };
      const link = await deps.auth.passwordLink(row.customer_user_id, row.recipient_email, row.kind === "account_setup_link" ? "reset" : "setup");
      // persist ENCRYPTED before the network call so an ambiguous retry re-sends the identical message
      const ok = await db.updateOutboxPayload(row.id, row.processing_lease_token!, encryptPayload({ link, created_at: Date.now() } satisfies SetupSecret, row.idempotency_key));
      if (!ok) throw new LeaseLost();
      return { href: link };
    }
  }
}
class LeaseLost extends Error {}

async function logHistory(db: DataStore, row: OutboxRow, subject: string, status: "Sent" | "Failed" | "Pending", note?: string) {
  if (!row.order_id) return;
  try {
    await db.insertNotification({
      order_id: row.order_id,
      recipient_phone: null,
      recipient_email: row.recipient_email,
      channel: "Email",
      message_body: `${subject}\n[secure link — not stored]${note ? `\n(${note})` : ""}`,
      delivery_status: status,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* history logging never breaks delivery */
  }
}

/** A delayed (cron) delivery of the set-up email also updates the order's account status for staff. */
async function markSetupSent(db: DataStore, row: OutboxRow) {
  if (row.kind !== "order_confirmed_new_customer" || !row.order_id) return;
  try {
    const o = await db.getOrder(row.order_id);
    if (o && o.customer_user_id === row.customer_user_id && ["setup_email_pending", "account_created", "pending"].includes(o.provisioning_status))
      await db.updateOrder(o.id, { provisioning_status: "setup_email_sent" });
  } catch {
    /* status display only; the email itself was accepted */
  }
}

async function deliver(db: DataStore, row: OutboxRow, provider: MailProvider, deps: ProcessDeps, sum: ProcessSummary) {
  const lease = row.processing_lease_token!;
  let subject: string = row.kind;
  try {
    const l = await linkFor(db, row, deps);
    if ("stop" in l) {
      await db.failOutbox(row.id, lease, l.stop, true, 60);
      sum.failed++;
      return;
    }
    const mail = renderEmail(row.kind, row.template_data as TemplateData, l.href);
    subject = mail.subject;
    const out = await provider.send({ to: row.recipient_email, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: row.idempotency_key });
    if (out.kind === "accepted") {
      if (await db.completeOutbox(row.id, lease, out.providerMessageId)) {
        sum.sent++;
        await markSetupSent(db, row);
        await logHistory(db, row, mail.subject, "Sent", provider.name === "demo" ? "simulated — Demo Inbox, no email provider connected" : `accepted by ${provider.name}`);
      }
      return; // false: our lease expired and another worker owns the row — never overwrite it
    }
    const permanent = out.kind === "permanent" || row.attempt_count >= row.max_attempts;
    if (await db.failOutbox(row.id, lease, sanitizeError(out.error), out.kind === "permanent", backoffSeconds(row.attempt_count))) {
      if (permanent) { sum.failed++; await logHistory(db, row, mail.subject, "Failed", sanitizeError(out.error)); }
      else sum.retrying++;
    }
  } catch (e) {
    if (e instanceof LeaseLost) return;
    if (e instanceof OutboxKeyError) {
      // configuration problem (missing / rotated-out key): counted as an attempt with a long backoff,
      // so it ends as a visible permanent failure instead of looping forever
      console.error("[outbox] encryption key problem:", sanitizeError(e));
      if (await db.failOutbox(row.id, lease, "email encryption key not configured / rotated out", false, Math.max(15 * 60, backoffSeconds(row.attempt_count)))) {
        if (row.attempt_count >= row.max_attempts) { sum.failed++; await logHistory(db, row, subject, "Failed", "email encryption key not configured"); }
        else sum.released++;
      }
      return;
    }
    const permanent = e instanceof OutboxDecryptError; // tampered / corrupted envelope: never retry it
    if (await db.failOutbox(row.id, lease, sanitizeError(e), permanent, backoffSeconds(row.attempt_count))) {
      if (permanent || row.attempt_count >= row.max_attempts) { sum.failed++; await logHistory(db, row, subject, "Failed", "could not prepare the message"); }
      else sum.retrying++;
    }
  }
}

export async function processOutbox(store: DataStore, deps: ProcessDeps = {}, opts: { limit?: number; onlyId?: string } = {}): Promise<ProcessSummary> {
  const db = store.elevated();
  const provider = deps.provider === undefined ? selectMailProvider(db) : deps.provider;
  const sum: ProcessSummary = { provider: provider?.name ?? "none", claimed: 0, sent: 0, retrying: 0, failed: 0, released: 0, scrubbed: 0 };
  sum.scrubbed = await db.scrubOutbox();
  if (!provider) return sum; // nothing configured: rows stay 'pending' — never reported as sent
  const rows = await db.claimOutbox(opts.limit ?? 20, LEASE_SECONDS, opts.onlyId); // committed before any network I/O
  sum.claimed = rows.length;
  for (const row of rows) await deliver(db, row, provider, deps, sum);
  return sum;
}

/** Sends one queued row now if possible. Never throws; returns the row's resulting status. */
export async function kickOutbox(store: DataStore, id: string, deps: ProcessDeps = {}): Promise<OutboxRow["delivery_status"] | "unknown"> {
  try {
    await processOutbox(store, deps, { limit: 1, onlyId: id });
    return (await store.elevated().getOutbox(id))?.delivery_status ?? "unknown";
  } catch (e) {
    console.warn("[outbox] immediate delivery deferred:", sanitizeError(e));
    return "unknown";
  }
}
