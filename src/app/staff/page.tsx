import { ClipboardList, Hammer, Inbox, Plus, Receipt, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import {
  CardSection, DarkCard, DarkFigure, DarkStats, DashboardHeader, darkPrimary, darkSecondary, dashCard, headerPrimary, KpiCard, KpiRow,
} from "@/components/dashboard";
import { OfficeWorkspace } from "@/components/office/office-workspace";
import { PortalShell } from "@/components/portal-shell";
import { addDays, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData } from "@/lib/server/office-data";
import { staffTasks, workspaceMetrics } from "@/lib/services/insights";
import { cn } from "@/lib/utils";

export const metadata = { title: "Operations & Order Queue" };

/** S-01 — dashboard: greeting, four KPI cards, today's tasks beside the counter card, then the order queue (+ drawer). */
export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(["staff", "owner"]);
  const sp = await searchParams;
  const data = await loadOfficeData(await getStore());
  const now = new Date();
  const today = todayISO(now);
  const m = workspaceMetrics(data.orders, data.payments);
  const t = staffTasks(data.orders, data.payments, data.deliveries, data.exceptions, data.notifications);
  const code = (id: string) => data.orders.find((o) => o.id === id)?.order_code ?? "";
  // one line per pending job; each opens that order's drawer on the right tab
  const inbox: { id: string; order: string; label: string; tab: string }[] = [
    ...t.toConfirm.map((o) => ({ id: o.id, order: o.order_code, label: o.order_origin === "customer_self_service" ? "Check and confirm the online order" : "Confirm the order", tab: "quotation" })),
    ...t.specProposals.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Review the customer's proposed changes", tab: "overview" })),
    ...t.toQuote.map((o) => ({ id: o.id, order: o.order_code, label: "Issue the quotation", tab: "quotation" })),
    ...t.paymentsToVerify.map(({ payment, order }) => ({ id: order.id, order: order.order_code, label: `Verify a ${payment.payment_method} payment (${formatPeso(payment.amount)}, ref. ${payment.reference_number ?? "-"})`, tab: "payments" })),
    ...t.needsDownPayment.map(({ order, shortfall }) => ({ id: order.id, order: order.order_code, label: `Waiting for the 30% down payment (${formatPeso(shortfall)} short)`, tab: "payments" })),
    ...t.readyForProduction.map((o) => ({ id: o.id, order: o.order_code, label: "Release to the workshop (30% verified)", tab: "payments" })),
    ...t.cashHandovers.map(({ payment, order }) => ({ id: order.id, order: order.order_code, label: `Verify cash handover (${formatPeso(payment.amount)})`, tab: "payments" })),
    ...t.specQuestions.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Answer a craftsman's question", tab: "overview" })),
    ...t.failedDeliveries.map(({ order }) => ({ id: order.id, order: order.order_code, label: "Reschedule a failed delivery", tab: "overview" })),
    ...t.toSchedule.filter((o) => !t.failedDeliveries.some((f) => f.order.id === o.id)).map((o) => ({ id: o.id, order: o.order_code, label: "Schedule driver & vehicle", tab: "overview" })),
    ...t.touchUps.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Touch-up / repair work order", tab: "overview" })),
    ...t.missingFields.map(({ order, missing }) => ({ id: order.id, order: order.order_code, label: `Complete missing fields: ${missing.join(", ")}`, tab: "overview" })),
    ...t.failedSms.map((n) => ({ id: n.order_id, order: code(n.order_id), label: "Retry a failed customer SMS", tab: "quotation" })),
  ];
  const openId = typeof sp.order === "string" ? sp.order : null;
  const newThisWeek = data.orders.filter((o) => todayISO(new Date(o.created_at)) >= addDays(today, -6)).length;
  const toVerify = t.paymentsToVerify.length + t.cashHandovers.length;
  const tip = inbox.length
    ? `Start with ${inbox[0].order}: ${inbox[0].label.charAt(0).toLowerCase()}${inbox[0].label.slice(1)}.`
    : "The counter is clear. New online orders will appear here as they arrive.";
  const portal = actor.role === "owner" ? "owner" : "staff";

  const taskLink = (x: (typeof inbox)[number], i: number) => (
    <li key={`${x.id}-${i}`}>
      <Link href={`/staff?order=${x.id}&tab=${x.tab}`} scroll={false} className="flex min-h-12 items-center gap-3 px-1 py-2.5 text-sm hover:bg-accent-soft/60 sm:px-2">
        <b className="shrink-0 tabular-nums">{x.order}</b><span className="min-w-0">{x.label}</span>
      </Link>
    </li>
  );

  return (
    <PortalShell portal={portal} actor={actor} badges={portal === "staff" ? { "/staff#task-inbox": inbox.length } : undefined}>
      <DashboardHeader name={actor.full_name} now={now}
        summary={inbox.length ? `${inbox.length} ${inbox.length === 1 ? "task" : "tasks"} waiting at the counter` : "nothing waiting at the counter"}
        actions={<Link href="/staff/new" className={headerPrimary}><Plus className="size-4" aria-hidden /> New walk-in order</Link>} />

      <KpiRow testid="kpi-strip">
        <KpiCard testid="kpi-to-confirm" label="To confirm" value={m.toConfirm} icon={<ClipboardList />}
          sub={<><TrendingUp className="size-3.5" aria-hidden /> {newThisWeek} new in the last 7 days</>} tone={newThisWeek ? "good" : "muted"} />
        <KpiCard testid="kpi-quote-payment" label="Quotation & payment" value={m.quotationAndPayment} icon={<Receipt />}
          sub="confirmed, before production" />
        <KpiCard testid="kpi-workshop" label="In the workshop" value={m.inWorkshop} icon={<Hammer />} sub="building or inspection" />
        <KpiCard testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} icon={<Wallet />}
          sub="verified payments · active orders" tone="good" />
      </KpiRow>

      <div className="mb-3 sm:mb-5 grid gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="tasks-title" className={cn(dashCard, "min-w-0 p-3.5 sm:p-5")}>
          <div className="mb-3 flex items-center gap-2">
            <Inbox className="size-5 text-primary" aria-hidden />
            <h2 id="tasks-title" className="text-base font-bold sm:text-lg">Today&apos;s tasks</h2>
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">{inbox.length}</span>
          </div>
          {inbox.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Nothing waiting. 🎉</p> : (
            <ul className="divide-y divide-border border-y border-border">{inbox.slice(0, 5).map(taskLink)}</ul>
          )}
          <details id="task-inbox" className="mt-3 scroll-mt-6" data-testid="task-inbox">
            <summary className="cursor-pointer text-sm font-semibold text-primary">Task inbox · all {inbox.length}</summary>
            {inbox.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing waiting. 🎉</p> : (
              <ul className="mt-2 divide-y divide-border border-y border-border">{inbox.map(taskLink)}</ul>
            )}
          </details>
        </section>

        <DarkCard id="counter-title" title="At the counter today">
          <DarkFigure value={inbox.length} caption={`${inbox.length === 1 ? "task" : "tasks"} waiting`}
            note={toVerify ? `${toVerify} ${toVerify === 1 ? "payment" : "payments"} to verify` : "No payments waiting to be verified"} noteTone={toVerify ? "warning" : "good"} />
          <DarkStats items={[
            { label: "To quote", value: t.toQuote.length },
            { label: "To schedule", value: t.toSchedule.length },
            { testid: "kpi-delivery", label: "Ready / out", value: m.delivery },
          ]} />
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">{tip}</p>
          <div className="mt-auto flex gap-2">
            {inbox[0]
              ? <Link href={`/staff?order=${inbox[0].id}&tab=${inbox[0].tab}`} scroll={false} className={darkPrimary}>Open next task</Link>
              : <Link href="/staff/new" className={darkPrimary}>New walk-in order</Link>}
            <a href="#queue" className={darkSecondary}>Queue</a>
          </div>
        </DarkCard>
      </div>

      <CardSection id="queue" title="Operations & Order Queue" chip="Shared live record">
        <OfficeWorkspace actor={actor} data={data} basePath="/staff" openId={openId} tab={typeof sp.tab === "string" ? sp.tab : undefined} intro={false}
          title="Operations & Order Queue" description="" />
      </CardSection>
    </PortalShell>
  );
}
