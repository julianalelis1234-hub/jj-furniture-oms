import { Mail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppShell, EmptyState } from "@/components/app-shell";
import { isDemoMode } from "@/lib/config";
import type { MemoryStore } from "@/lib/data/memory-store";
import { formatDateTime } from "@/lib/domain/dates";
import { getPublicStore } from "@/lib/server/context";
import { addressOf, mailConfig } from "@/lib/email/mailer";
import { SendNowButton } from "./send-now-button";

const PROVIDER_LABEL = { resend: "Resend (real email)", gmail: "Gmail SMTP (real email)", demo: "Demo Inbox only (no real email is sent)", none: "None" } as const;
const KIND_LABEL: Record<string, string> = {
  quote_review_ready: "Quotation ready (Email 1)",
  order_confirmed_new_customer: "Order confirmed + set password (Email 2)",
  order_confirmed_returning_customer: "Order confirmed — returning customer",
  account_setup_link: "Password set-up link",
};

export const metadata = { title: "Demo inbox" };

/**
 * DEMO ONLY: the simulated inbox for emails the app "sent" (quotation review
 * links, password set-up and reset links). Real emails never pass through here;
 * this page does not exist in production.
 */
export default async function DemoInboxPage() {
  await connection(); // always render at request time (live demo data)
  if (!isDemoMode()) notFound();
  const store = await getPublicStore();
  const mails = store.kind === "memory" ? (store as MemoryStore).t.demo_mailbox : [];
  const cfg = mailConfig();
  const sender = cfg.provider === "gmail" ? addressOf(process.env.GMAIL_SMTP_USER ?? "") : cfg.provider === "resend" ? addressOf(process.env.EMAIL_FROM ?? "") : null;
  const queue = store.kind === "memory" ? [...(store as MemoryStore).t.notification_outbox].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12) : [];
  const linkify = (text: string) =>
    text.split(/(\S*\/customer\/[^\s]+)/g).map((part, i) =>
      /\/customer\//.test(part) ? (
        <Link key={i} href={part.replace(/^https?:\/\/[^/]+/, "")} className="font-semibold break-all text-primary underline" data-testid="inbox-link">
          {part.includes("token") ? "Open secure link" : part}
        </Link>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-3xl gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Mail className="size-6 text-primary" aria-hidden /> Demo inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Emails appear here only when no real email provider is connected. Each link works exactly like the real email would; secure links work once.
          </p>
        </div>
        <section className="jj-surface grid gap-3 rounded-2xl border bg-card p-4" data-testid="email-delivery-status">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Email delivery status</h2>
            <span className="ml-auto"><SendNowButton /></span>
          </div>
          <p className="text-sm">
            Sending through: <b data-testid="email-provider">{PROVIDER_LABEL[cfg.provider]}</b>{sender && <> from <b>{sender}</b></>}
          </p>
          {cfg.problems.length > 0 && (
            <ul className="grid gap-1 rounded-xl border border-warning/50 bg-warning-soft p-3 text-sm" data-testid="email-config-problems">
              {cfg.problems.map((p) => <li key={p}>⚠ {p}</li>)}
              <li className="text-xs text-muted-foreground">Fix .env.local (in the project folder, next to package.json), then stop and restart <code>npm run dev</code>.</li>
            </ul>
          )}
          {queue.length > 0 && (
            <ul className="grid gap-1.5 text-sm" data-testid="email-queue">
              {queue.map((o) => (
                <li key={o.id} className="grid gap-0.5 rounded-lg border p-2">
                  <span><b>{KIND_LABEL[o.kind] ?? o.kind}</b> → {o.recipient_email} · {formatDateTime(o.created_at)}</span>
                  <span className={o.delivery_status === "sent" ? "text-success" : o.delivery_status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                    {o.delivery_status === "sent" ? `Sent (accepted by ${o.provider_message_id?.split(":")[0]})` : o.delivery_status}
                    {o.delivery_status !== "sent" && ` · attempt ${o.attempt_count}/${o.max_attempts}`}
                    {o.is_permanent_failure && " · gave up"}
                    {o.last_sanitized_error && ` · ${o.last_sanitized_error}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {mails.length === 0 ? <EmptyState title="No emails yet" /> : (
          <ul className="grid gap-3">
            {mails.map((m) => (
              <li key={m.id} className="rounded-xl border bg-card p-4" data-testid="inbox-item">
                <p className="text-xs text-muted-foreground">To <b className="text-foreground">{m.to}</b> · {formatDateTime(m.created_at)}</p>
                <p className="mt-1 font-semibold">{m.subject}</p>
                <p className="mt-2 text-sm whitespace-pre-line">{linkify(m.text)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
