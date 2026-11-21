import { isDemoMode } from "@/lib/config";
import type { DataStore } from "@/lib/data/store";
import type { MemoryStore } from "@/lib/data/memory-store";
import type { NotificationStatus } from "@/lib/domain/types";

export interface EmailMessage {
  /** order the email is about (null for account emails such as a password reset: not written to an order log) */
  order_id: string | null;
  to: string;
  subject: string;
  /** plain text; may contain secure one-time links */
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ status: NotificationStatus; detail?: string }>;
}

/** Resend (resend.com) — used only when RESEND_API_KEY and EMAIL_FROM are set. */
export const resendEmail = (apiKey: string, from: string): EmailProvider => ({
  name: "resend",
  async send(msg) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      });
      return res.ok ? { status: "Sent" } : { status: "Failed", detail: `Email API HTTP ${res.status}` };
    } catch {
      return { status: "Failed", detail: "Email API unreachable" };
    }
  },
});

/** Demo only: nothing leaves the server; the full message goes to the in-memory demo inbox. */
export const simulatedEmail = (store: DataStore): EmailProvider => ({
  name: "simulated (demo)",
  async send(msg) {
    if (store.kind === "memory") {
      (store as MemoryStore).t.demo_mailbox.unshift({
        id: crypto.randomUUID(), to: msg.to, subject: msg.subject, text: msg.text, order_id: msg.order_id, created_at: new Date().toISOString(),
      });
    }
    return { status: "Sent" };
  },
});

/** Production without a provider: recorded as Pending (the secure link is NOT stored; staff resend a fresh link later). */
export const unsentEmail: EmailProvider = {
  name: "none",
  async send() {
    return { status: "Pending", detail: "No email provider configured" };
  },
};

export function emailMode(): "provider" | "simulated" | "none" {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return "provider";
  return isDemoMode() ? "simulated" : "none";
}
export const EMAIL_SIMULATED_NOTE = "(simulated — no email provider connected)";

export function emailProvider(store: DataStore): EmailProvider {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return resendEmail(process.env.RESEND_API_KEY, process.env.EMAIL_FROM);
  return isDemoMode() ? simulatedEmail(store) : unsentEmail;
}

/** Any one-time link is replaced before the message is written to the notification log. */
export function redactLinks(text: string): string {
  return text.replace(/\S*[?&](token|token_hash)=\S+/gi, "[secure one-time link — not stored]");
}

/**
 * Sends an email and logs it on the order (channel Email). The log never
 * contains the secure link itself. Never throws: delivery problems are
 * recorded as Failed / Pending so the business action that triggered the
 * email (an issued quote, an accepted quote) is never undone.
 */
export async function sendEmail(store: DataStore, msg: EmailMessage, provider = emailProvider(store)) {
  let result: { status: NotificationStatus; detail?: string };
  try {
    result = await provider.send(msg);
  } catch {
    result = { status: "Failed", detail: "Email provider error" };
  }
  try {
    if (msg.order_id) await store.elevated().insertNotification({
      order_id: msg.order_id,
      recipient_phone: null,
      recipient_email: msg.to,
      channel: "Email",
      message_body: `${msg.subject}\n${redactLinks(msg.text)}${result.detail ? `\n(${result.detail})` : ""}`,
      delivery_status: result.status,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* logging must not break the caller */
  }
  return result;
}

/** Absolute base for links in emails; empty in demo without a configured URL (links are then site-relative). */
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
