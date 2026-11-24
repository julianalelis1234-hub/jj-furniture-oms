"use client";

import { KeyRound, MailCheck, Printer } from "lucide-react";
import type { OrderSlip } from "@/app/actions";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/domain/dates";

/**
 * The paper-style order slip shown right after an online submission. Its JJ code
 * is the order's permanent ID and its slip number. Printing shows only the slip.
 */
export function OrderSlipView({ slip }: { slip: OrderSlip }) {
  const rows: [string, string][] = [
    ["Customer", slip.customer_name],
    ["Mobile", slip.customer_phone],
    ["Deliver to", `${slip.delivery_address}, ${slip.municipality}`],
    ["Item", `${slip.quantity} × ${slip.item}`],
    ["Size (W × H × D)", slip.size],
    ["Wood", slip.wood],
    ["Finish", slip.finish],
    ...(slip.notes ? [["Notes", slip.notes] as [string, string]] : []),
  ];
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <article data-testid="request-done" aria-labelledby="slip-title"
        className="print-slip relative rounded-[1.25rem] border border-foreground/20 bg-card px-6 pt-7 pb-6 shadow-[0_1px_0_0_var(--border)] sm:px-8">
        {/* the tear-off edge of a paper slip */}
        <div aria-hidden className="absolute inset-x-6 top-0 border-t-2 border-dashed border-foreground/25" />
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="slip-title" className="text-lg">Order slip</h2>
            <p className="text-sm text-muted-foreground">JJ Enterprises — Furniture and Lumber Dealer</p>
          </div>
          <p className="text-right text-xs text-muted-foreground">Submitted<br /><span className="font-semibold text-foreground">{formatDateTime(slip.submitted_at)}</span></p>
        </header>
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">Order ID</p>
          <p className="text-[clamp(2rem,9vw,3rem)] leading-none font-extrabold tracking-[-0.03em] tabular-nums" data-testid="request-code">{slip.order_code}</p>
        </div>
        <dl className="mt-6 divide-y divide-border border-y border-border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-x-6 gap-y-0.5 py-2.5">
              <dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold sm:max-w-[65%]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-sm">
          <b>Status: waiting for confirmation.</b> No price yet: the shop checks your design first, then sends the official quotation.
        </p>
      </article>

      <div className="no-print grid gap-4">
        <p className="flex items-start gap-3 text-sm">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span>When the shop confirms your order, we email <b data-testid="request-email">{slip.email}</b> a link to create your password. Then you can log in, see your quotation and pay.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="xl" className="rounded-full" onClick={() => window.print()}><Printer aria-hidden /> Print or save slip</Button>
          <LinkButton href="/login" variant="outline" size="xl" className="rounded-full"><KeyRound aria-hidden /> Log in</LinkButton>
        </div>
      </div>
    </div>
  );
}
