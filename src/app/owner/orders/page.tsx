import { ClipboardList, Hammer, Plus, Receipt, Wallet } from "lucide-react";
import Link from "next/link";
import { CardSection, DarkCard, DarkFigure, DarkStats, dashCard, headerPrimary, KpiCard, KpiRow } from "@/components/dashboard";
import { OfficeWorkspace } from "@/components/office/office-workspace";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { formatPeso, furniturePaidFrom } from "@/lib/domain/finance";
import type { OrderStatus } from "@/lib/domain/types";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";
import { workspaceMetrics } from "@/lib/services/insights";
import { cn } from "@/lib/utils";

export const metadata = { title: "Orders & Quotations" };

/** The seven stages every order moves through, left to right. */
const STAGES: { label: string; statuses: OrderStatus[] }[] = [
  { label: "Waiting", statuses: ["Quote Requested", "Waiting for Confirmation"] },
  { label: "Confirmed", statuses: ["Confirmed"] },
  { label: "In production", statuses: ["In Production"] },
  { label: "Inspection", statuses: ["Completed / For Inspection"] },
  { label: "Ready", statuses: ["Ready for Delivery"] },
  { label: "On the road", statuses: ["Out for Delivery"] },
  { label: "Delivered", statuses: ["Delivered"] },
];

/** Owner · Orders & Quotations: headline cards, the stage pipeline beside the quotations card, then the queue + order drawer. */
export default async function OwnerOrders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(["owner"]);
  const sp = await searchParams;
  const { data, badges } = await loadOwnerContext(await getStore());
  const m = workspaceMetrics(data.orders, data.payments);
  const openId = typeof sp.order === "string" ? sp.order : null;

  // quotations: where every confirmed order stands before production
  const paid = (id: string) => furniturePaidFrom(data.payments.filter((p) => p.order_id === id));
  const confirmed = data.orders.filter((o) => o.status === "Confirmed");
  const toIssue = confirmed.filter((o) => !o.quotation_issued_at);
  const withCustomer = confirmed.filter((o) => o.quotation_issued_at && !o.specs_confirmed);
  const accepted = confirmed.filter((o) => o.specs_confirmed);
  const short = accepted.filter((o) => paid(o.id) < o.standard_down_payment_due && !o.payment_exception_approved);
  const ready = accepted.length - short.length;
  const quotedValue = withCustomer.reduce((s, o) => s + (o.furniture_price ?? 0), 0);
  const counts = STAGES.map((s) => data.orders.filter((o) => s.statuses.includes(o.status)).length);
  const busiest = counts.indexOf(Math.max(...counts.slice(0, 6)));

  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Orders & Quotations" description="Confirm new orders, issue quotations, verify payments and follow every order to the door."
        actions={<Link href="/staff/new" className={headerPrimary}><Plus className="size-4" aria-hidden /> New order</Link>} />

      <KpiRow testid="kpi-strip">
        <KpiCard testid="kpi-to-confirm" label="To confirm" value={m.toConfirm} icon={<ClipboardList />} sub="new orders to check" tone={m.toConfirm ? "warning" : "muted"} />
        <KpiCard testid="kpi-quote-payment" label="Quotation & payment" value={m.quotationAndPayment} icon={<Receipt />} sub="confirmed, before production" />
        <KpiCard testid="kpi-workshop" label="In the workshop" value={m.inWorkshop} icon={<Hammer />} sub={`${m.delivery} ready or out for delivery`} />
        <KpiCard testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} icon={<Wallet />} sub="verified payments · active orders" tone="good" />
      </KpiRow>

      <div className="mb-3 grid gap-3 sm:mb-5 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="pipeline-title" className={cn(dashCard, "flex min-w-0 flex-col p-3.5 sm:p-5")}>
          <div className="mb-3 flex flex-wrap items-baseline gap-2 sm:mb-4">
            <h2 id="pipeline-title" className="text-base font-bold sm:text-lg">Order pipeline</h2>
            <span className="text-xs text-muted-foreground sm:text-sm">{data.orders.length} orders across the seven stages</span>
          </div>
          {/* the seven stages as one connected strip; the busiest open stage is highlighted */}
          <ol className="grid flex-1 grid-cols-4 gap-1.5 sm:grid-cols-7 sm:gap-2" data-testid="order-pipeline">
            {STAGES.map((s, i) => (
              <li key={s.label} className={cn("relative flex flex-col justify-between gap-2 rounded-xl p-2 sm:p-3", i === busiest && counts[i] > 0 ? "bg-primary text-primary-foreground" : "bg-muted/60")}>
                <span className={cn("block text-[10px] font-semibold leading-tight sm:text-xs", i === busiest && counts[i] > 0 ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  <span className="tabular-nums">{i + 1}.</span> {s.label}
                </span>
                <b className="block text-xl leading-none font-extrabold tabular-nums sm:text-4xl">{counts[i]}</b>
                {i < STAGES.length - 1 && <span aria-hidden className="absolute top-1/2 -right-1.5 z-10 hidden size-3 -translate-y-1/2 rotate-45 border-t-2 border-r-2 border-border bg-transparent sm:block" />}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground sm:text-sm">
            A job starts in the workshop only after the customer accepts the quotation and the 30% down payment is verified.
          </p>
        </section>

        <DarkCard id="quotes-title" title="Quotations">
          <DarkFigure value={withCustomer.length} caption={withCustomer.length === 1 ? "quotation with the customer" : "quotations with customers"}
            note={withCustomer.length ? `${formatPeso(quotedValue)} waiting for acceptance` : "None waiting for acceptance"} noteTone={withCustomer.length ? "warning" : "good"} />
          <DarkStats items={[
            { label: "To issue", value: toIssue.length },
            { label: "Need 30%", value: short.length },
            { label: "Ready", value: ready },
          ]} />
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">
            {toIssue.length ? `${toIssue.length} confirmed ${toIssue.length === 1 ? "order needs" : "orders need"} a quotation. Open it below and use Issue quotation.`
              : short.length ? `${short.length} accepted ${short.length === 1 ? "order is" : "orders are"} waiting for the 30% down payment.`
                : "Every confirmed order has its quotation."}
          </p>
        </DarkCard>
      </div>

      <CardSection id="queue" title="Order queue" chip="Tap an order to open it">
        <OfficeWorkspace actor={actor} data={data} basePath="/owner/orders" openId={openId} tab={typeof sp.tab === "string" ? sp.tab : undefined} intro={false}
          title="Orders & Quotations" description="" />
      </CardSection>
    </OwnerShell>
  );
}
