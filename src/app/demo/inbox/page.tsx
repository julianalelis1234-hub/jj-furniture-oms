import { Mail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, EmptyState } from "@/components/app-shell";
import { isDemoMode } from "@/lib/config";
import type { MemoryStore } from "@/lib/data/memory-store";
import { formatDateTime } from "@/lib/domain/dates";
import { getPublicStore } from "@/lib/server/context";

export const metadata = { title: "Demo inbox" };

/**
 * DEMO ONLY: the simulated inbox for emails the app "sent" (quotation review
 * links, password set-up and reset links). Real emails never pass through here;
 * this page does not exist in production.
 */
export default async function DemoInboxPage() {
  if (!isDemoMode()) notFound();
  const store = await getPublicStore();
  const mails = store.kind === "memory" ? (store as MemoryStore).t.demo_mailbox : [];
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
            Simulated emails (no email provider is connected in demo mode). Each link works exactly like the real email would; secure links work once.
          </p>
        </div>
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
