import "server-only";
import nodemailer from "nodemailer";
import { isDemoMode } from "@/lib/config";
import type { DataStore } from "@/lib/data/store";
import type { MemoryStore } from "@/lib/data/memory-store";

/**
 * Transactional email delivery. Providers, in order of preference:
 *   1. Resend      RESEND_API_KEY + EMAIL_FROM            (recommended; supports Idempotency-Key)
 *   2. Gmail SMTP  GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD (smtp.gmail.com:465, implicit TLS)
 *   3. Demo        NEXT_PUBLIC_APP_MODE=demo only: the message is rendered into the
 *                  in-memory Demo Inbox (nothing leaves the server)
 * With none of these, nothing is "sent": the outbox keeps the row pending.
 *
 * Outcomes:
 *   accepted  — the provider ACCEPTED the message (provider message id). This is not proof
 *               of inbox delivery; bounces after acceptance are the provider's domain.
 *   retry     — temporary or AMBIGUOUS (e.g. network timeout: it may or may not have been
 *               accepted). Retried with backoff using the SAME idempotency key, so Resend
 *               de-duplicates; SMTP has no such key, so Gmail delivery is at-least-once.
 *   permanent — the provider rejected it for good (invalid / unknown address): stop retrying.
 * Errors are sanitized before they are stored or logged: no links, tokens or addresses.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
/** The claim lease outlives one provider request (timeout + 30 s). */
export const LEASE_SECONDS = Math.ceil(REQUEST_TIMEOUT_MS / 1000) + 30;

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** stable per outbox row (automatic retries); a new UUID-based key per manual resend */
  idempotencyKey: string;
}
export type SendOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "retry"; error: string }
  | { kind: "permanent"; error: string };
export interface MailProvider {
  readonly name: "resend" | "gmail" | "demo";
  send(msg: OutgoingEmail): Promise<SendOutcome>;
}

/** No URLs, query tokens, e-mail addresses or long opaque strings; bounded length. */
export function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? "unknown error");
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[?&](token|token_hash|code|access_token|refresh_token)=[^&\s]+/gi, "[secret]")
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, "[email]")
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
/** "Name <addr@x>" or "addr@x" → the bare address (lower case). */
export function addressOf(from: string): string | null {
  const m = from.match(/<([^>]+)>\s*$/);
  const a = (m ? m[1] : from).trim().toLowerCase();
  return EMAIL_RE.test(a) ? a : null;
}

// ---------------------------------------------------------------- Resend ----
export function resendProvider(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): MailProvider {
  return {
    name: "resend",
    async send(msg) {
      let res: Response;
      try {
        res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": msg.idempotencyKey },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        // timeout / connection reset: the request MAY have been accepted — retry with the same key
        return { kind: "retry", error: `Resend request did not complete (${sanitizeError(e)})` };
      }
      let body: { id?: string; name?: string; message?: string } = {};
      try { body = await res.json(); } catch { /* non-JSON body */ }
      if (res.ok && body.id) return { kind: "accepted", providerMessageId: `resend:${body.id}` };
      const detail = `Resend HTTP ${res.status}${body.name ? ` ${body.name}` : ""}`;
      if (res.status === 429 || res.status >= 500) return { kind: "retry", error: detail };
      if (res.status === 409 && body.name === "concurrent_idempotent_requests") return { kind: "retry", error: detail };
      if (res.status === 401 || res.status === 403) return { kind: "retry", error: `${detail} (check RESEND_API_KEY / sending domain)` };
      return { kind: "permanent", error: `${detail} ${sanitizeError(body.message ?? "")}`.trim() }; // 400/422: invalid address or payload
    },
  };
}

// ------------------------------------------------------------ Gmail SMTP ----
type Transport = Pick<ReturnType<typeof nodemailer.createTransport>, "sendMail">;
export function gmailProvider(user: string, appPassword: string, fromName: string, createTransport: (o: object) => Transport = (o) => nodemailer.createTransport(o)): MailProvider {
  const transport = createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // implicit TLS
    auth: { user, pass: appPassword },
    connectionTimeout: REQUEST_TIMEOUT_MS,
    greetingTimeout: 10_000,
    socketTimeout: REQUEST_TIMEOUT_MS,
  });
  return {
    name: "gmail",
    async send(msg) {
      try {
        // From must be the authenticated Gmail address (or one of its verified aliases)
        const info = await transport.sendMail({ from: { name: fromName, address: user }, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
          headers: { "X-Entity-Ref-ID": msg.idempotencyKey } });
        return { kind: "accepted", providerMessageId: `gmail:${String(info.messageId ?? "").slice(0, 180)}` };
      } catch (e) {
        const err = e as { responseCode?: number; code?: string };
        const code = err.responseCode;
        if (code === 535 || code === 534) return { kind: "retry", error: `Gmail SMTP authentication failed (${code}) — check the App Password` };
        if (code && code >= 500 && code < 600) return { kind: "permanent", error: `Gmail SMTP rejected the message (${code})` };
        return { kind: "retry", error: `Gmail SMTP ${err.code ?? code ?? "error"} (${sanitizeError(e)})` };
      }
    },
  };
}

// ------------------------------------------------------------------ demo ----
export function demoPreviewProvider(store: DataStore): MailProvider {
  return {
    name: "demo",
    async send(msg) {
      if (store.kind !== "memory") return { kind: "retry", error: "Demo preview needs the in-memory demo store" };
      const id = crypto.randomUUID();
      (store as MemoryStore).t.demo_mailbox.unshift({ id, to: msg.to, subject: msg.subject, text: msg.text, order_id: null, created_at: new Date().toISOString() });
      return { kind: "accepted", providerMessageId: `demo-preview:${id}` };
    },
  };
}

// --------------------------------------------------------------- choose ----
export interface MailConfig {
  provider: "resend" | "gmail" | "demo" | "none";
  problems: string[];
}
/** Validates the environment without exposing any secret value. */
export function mailConfig(env: Record<string, string | undefined> = process.env, demo = isDemoMode()): MailConfig {
  const problems: string[] = [];
  if (env.RESEND_API_KEY || env.EMAIL_FROM) {
    if (!env.RESEND_API_KEY) problems.push("RESEND_API_KEY is missing");
    if (!env.EMAIL_FROM || !addressOf(env.EMAIL_FROM)) problems.push('EMAIL_FROM must be "Name <address@your-domain>"');
    if (!problems.length) return { provider: "resend", problems };
  }
  if (env.GMAIL_SMTP_USER || env.GMAIL_SMTP_APP_PASSWORD) {
    const p: string[] = [];
    if (!env.GMAIL_SMTP_USER || !addressOf(env.GMAIL_SMTP_USER)) p.push("GMAIL_SMTP_USER must be the Gmail address");
    if (!env.GMAIL_SMTP_APP_PASSWORD || env.GMAIL_SMTP_APP_PASSWORD.replace(/\s/g, "").length !== 16) p.push("GMAIL_SMTP_APP_PASSWORD must be the 16-character App Password");
    if (!p.length) return { provider: "gmail", problems };
    problems.push(...p);
  }
  if (demo) return { provider: "demo", problems };
  if (!problems.length) problems.push("No email provider configured (set RESEND_API_KEY + EMAIL_FROM, or GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD)");
  return { provider: "none", problems };
}

export function selectMailProvider(store: DataStore, env: Record<string, string | undefined> = process.env): MailProvider | null {
  const c = mailConfig(env);
  if (c.provider === "resend") return resendProvider(env.RESEND_API_KEY!, env.EMAIL_FROM!);
  if (c.provider === "gmail") return gmailProvider(addressOf(env.GMAIL_SMTP_USER!)!, env.GMAIL_SMTP_APP_PASSWORD!.replace(/\s/g, ""), env.EMAIL_FROM_NAME || "JJ Enterprises");
  if (c.provider === "demo") return demoPreviewProvider(store);
  return null;
}
