import { AlertTriangle, ArrowRight, ClipboardList, Hammer, Plus, Sparkles, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { DecideExceptionControls, InspectionControls } from "@/components/office/actions";
import { TaskCard } from "@/components/office/order-card";
import { ReviewProposalControls } from "@/components/office/spec-dialogs";
import { DarkCard, DarkFigure, DarkStats, DashboardHeader, darkPrimary, darkSecondary, dashCard, headerPrimary, headerSecondary, KpiCard, KpiRow } from "@/components/dashboard";
import { ActivityChart, DueBars } from "@/components/owner/dashboard-charts";
import { OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { StatusBadge } from "@/components/status";
import { toClientOrder } from "@/lib/client-order";
import { addDays, formatDate, formatDateTime, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { formatDims } from "@/lib/domain/furniture";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext, loadProposalSpecs, nameOf } from "@/lib/server/office-data";
import { isCustomerProposal } from "@/lib/services/exceptions";
import { ownerKpis, riskOf, workspaceMetrics } from "@/lib/services/insights";
import { inventorySummary } from "@/lib/services/inventory";
import { cn } from "@/lib/utils";

export const metadata = { title: "Owner dashboard" };

const card = dashCard;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const weekday = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(Date.parse(`${iso}T00:00:00Z`));

/** O-01 · Dashboard: greeting, four headline numbers, weekly activity, this week in the workshop, recent orders, then decisions. */
export default async function OwnerDashboard() {
  const actor = await requireActor(["owner"]);
  const store = await getStore();
  const { data, lumberItems, lumberMovements, badges } = await loadOwnerContext(store);
  const now = new Date();
  const today = todayISO(now);
  const byId = new Map(data.orders.map((o) => [o.id, toClientOrder(o)]));
  const k = ownerKpis(data.orders, data.deliveries, data.exceptions, today);
  const m = workspaceMetrics(data.orders, data.payments);
  const inv = inventorySummary(lumberItems, lumberMovements);
  const approvals = data.exceptions.filter((e) => e.status === "Pending" && ["Installment Approval", "Credit / Unpaid Balance", "Special Delivery Terms"].includes(e.category));
  const inspections = data.orders.filter((o) => o.status === "Completed / For Inspection");
  const proposals = data.exceptions.filter((e) => e.status === "Pending" && isCustomerProposal(e));
  const proposalSpecs = await loadProposalSpecs(store, proposals.map((e) => e.order_id));
  const decisions = approvals.length + inspections.length + proposals.length;
  const late = data.orders.filter((o) => o.status !== "Delivered" && riskOf(o, today) !== "on_track")
    .sort((a, b) => (a.estimated_completion_date ?? "").localeCompare(b.estimated_completion_date ?? ""));

  // weekly activity (days in the shop's time zone)
  const orderDays = data.orders.map((o) => todayISO(new Date(o.created_at)));
  const paymentDays = data.payments.filter((p) => p.verified_by_owner_or_staff).map((p) => todayISO(new Date(p.paid_at)));
  const weekAgo = addDays(today, -6);
  const newThisWeek = orderDays.filter((d) => d >= weekAgo).length;

  // this week in the workshop: jobs whose completion date falls in the next 7 days
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const open = data.orders.filter((o) => o.status !== "Delivered" && o.estimated_completion_date);
  const due = week.map((day, i) => ({ day, label: i === 0 ? "Today" : weekday(day), count: open.filter((o) => o.estimated_completion_date === day).length }));
  const dueThisWeek = due.reduce((s, d) => s + d.count, 0);
  const tip = decisions
    ? `${decisions} ${decisions === 1 ? "item waits" : "items wait"} for your decision: approvals, inspections or customer changes.`
    : late.length
      ? `${late.length} ${late.length === 1 ? "job is" : "jobs are"} past or close to the completion date. Check the workshop plan.`
      : "Every job is on schedule and nothing needs your approval.";

  const recent = data.orders.slice(0, 4);

  return (
    <OwnerShell actor={actor} badges={badges}>
      <DashboardHeader name={actor.full_name} now={now}
        summary={decisions ? `${decisions} waiting for your decision` : "nothing waiting for your decision"}
        actions={<>
          <Link href="/owner/orders" className={headerSecondary}><ClipboardList className="size-4 text-primary" aria-hidden /> Orders & Quotations</Link>
          <Link href="/staff/new" className={headerPrimary}><Plus className="size-4" aria-hidden /> New order</Link>
        </>} />

      <KpiRow testid="kpi-strip">
        <KpiCard testid="kpi-to-confirm" label="To confirm" value={m.toConfirm} icon={<ClipboardList />}
          sub={<><TrendingUp className="size-3.5" aria-hidden /> {newThisWeek} new in the last 7 days</>} tone={newThisWeek ? "good" : "muted"} />
        <KpiCard testid="kpi-workshop" label="In the workshop" value={m.inWorkshop} icon={<Hammer />}
          sub={`${k.waitingInspection} waiting for your inspection`} tone={k.waitingInspection ? "warning" : "muted"} />
        <KpiCard testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} icon={<Wallet />}
          sub="verified payments · active orders" tone="good" />
        <KpiCard testid="kpi-balances" label="Balances to collect" value={formatPeso(k.balancesToCollect)} icon={<Wallet />}
          sub={k.unpaidAfterDelivery.count ? `${formatPeso(k.unpaidAfterDelivery.amount)} unpaid after delivery` : "on active orders"}
          tone={k.unpaidAfterDelivery.count ? "warning" : "muted"} />
      </KpiRow>

      <div className="mb-3 sm:mb-5 grid gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={cn(card, "flex min-h-[15rem] min-w-0 flex-col p-3.5 sm:min-h-[22rem] sm:p-5")} aria-label="Shop activity">
          <ActivityChart orderDays={orderDays} paymentDays={paymentDays} today={today} />
        </section>

        <DarkCard id="week-title" title="This week in the workshop">
          <DarkFigure value={dueThisWeek} caption={`${dueThisWeek === 1 ? "job" : "jobs"} due in the next 7 days`} testid="kpi-late"
            note={k.delayedOrAtRisk ? `${k.delayedOrAtRisk} delayed or at risk` : "Nothing delayed or at risk"} noteTone={k.delayedOrAtRisk ? "warning" : "good"} />
          <DueBars days={due} />
          <DarkStats items={[
            { testid: "kpi-quote-payment", label: "Quote & payment", value: m.quotationAndPayment },
            { testid: "kpi-delivery", label: "Ready / out", value: m.delivery },
            { testid: "kpi-low-stock", label: "Low lumber", value: inv.lowStock.length },
          ]} />
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">{tip}</p>
          <div className="mt-auto flex gap-2">
            <a href="#decide-title" className={darkPrimary}>Review decisions</a>
            <Link href="/owner/craftsmen" className={darkSecondary}>Workshop</Link>
          </div>
        </DarkCard>
      </div>

      <section aria-labelledby="recent-title" className={cn(card, "mb-3 sm:mb-5 p-3.5 sm:p-5")}>
        <div className="mb-3 sm:mb-4 flex flex-wrap items-center gap-3">
          <h2 id="recent-title" className="text-base font-bold sm:text-lg">Recent orders</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" aria-hidden /> {newThisWeek} new this week · {m.toConfirm} waiting for confirmation
          </span>
          <Link href="/owner/orders" className="ml-auto text-sm font-semibold text-primary underline-offset-4 hover:underline">View all</Link>
        </div>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
            {recent.map((o) => (
              <li key={o.id}>
                <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="flex h-full flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-3 transition-colors sm:gap-2 sm:p-3.5 hover:bg-accent-soft/60">
                  <span className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground" aria-hidden>{initials(o.customer_name)}</span>
                    <b className="min-w-0 flex-1 truncate text-sm">{o.customer_name}</b>
                    <span className="text-xs font-semibold text-muted-foreground tabular-nums">{o.order_code}</span>
                  </span>
                  <span className="line-clamp-2 text-sm text-muted-foreground">{o.quantity} × {o.item_name}{formatDims(o) ? ` · ${formatDims(o)}` : ""}</span>
                  <span className="mt-auto"><StatusBadge status={o.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="decide-title" className={cn(card, "mb-3 sm:mb-5 scroll-mt-6 p-3.5 sm:p-5")}>
        <h2 id="decide-title" className="mb-2 flex items-center gap-2 text-base font-bold sm:text-lg">
          Awaiting your decision <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">{decisions}</span>
        </h2>
        {decisions === 0 ? <p className="py-2 text-sm text-muted-foreground">Nothing needs your approval right now.</p> : (
          <RowList>
            {proposals.map((e) => {
              const o = byId.get(e.order_id); if (!o) return null;
              return <TaskCard key={e.id} order={o} tone="warning" meta={<><b className="text-foreground">Customer proposed spec changes</b> · <span className="whitespace-pre-line">{e.description.replace(/^Customer proposed specification changes /, "")}</span></>}
                actions={<ReviewProposalControls ex={e} order={o} proposal={proposalSpecs[o.id] ?? null} />} />;
            })}
            {approvals.map((e) => {
              const o = byId.get(e.order_id); if (!o) return null;
              return <TaskCard key={e.id} order={o} tone="warning" meta={<><b className="text-foreground">{e.category}</b> · {e.description} <span className="block text-xs">{e.requested_by} · {formatDateTime(e.created_at)}</span></>} actions={<DecideExceptionControls ex={e} canApprove />} />;
            })}
            {inspections.map((o) => (
              <TaskCard key={o.id} order={byId.get(o.id)!} tone="info" meta={<><b className="text-foreground">Quality inspection</b> · {o.quantity} × {o.item_name}, {o.color_finish} · by {nameOf(data.profiles, o.assigned_craftsman_id)}</>} actions={<InspectionControls order={byId.get(o.id)!} />} />
            ))}
          </RowList>
        )}
      </section>

      <div className="grid gap-3 sm:gap-5 xl:grid-cols-2">
        <section aria-labelledby="late-title" className={cn(card, "p-3.5 sm:p-5")}>
          <h2 id="late-title" className="mb-2 text-base font-bold sm:text-lg">Delayed or at risk</h2>
          {late.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Every job is on schedule.</p> : (
            <RowList data-testid="late-orders">
              {late.map((o) => {
                const r = riskOf(o, today);
                return (
                  <li key={o.id}>
                    <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-3 hover:bg-accent-soft/60 sm:px-2">
                      <b className="tabular-nums">{o.order_code}</b>
                      <span className="min-w-0 flex-1 truncate text-sm">{o.item_name} · {nameOf(data.profiles, o.assigned_craftsman_id)}</span>
                      <span className={r === "delayed" ? "rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive" : "rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-bold text-warning"}>
                        {r === "delayed" ? "Delayed" : "At risk"} · due {formatDate(o.estimated_completion_date)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </RowList>
          )}
        </section>
        <section aria-labelledby="stock-title" className={cn(card, "p-3.5 sm:p-5")}>
          <h2 id="stock-title" className="mb-2 text-base font-bold sm:text-lg">Lumber to reorder</h2>
          {inv.lowStock.length === 0 ? <p className="py-2 text-sm text-muted-foreground">All lumber is above its reorder level.</p> : (
            <RowList data-testid="low-stock">
              {inv.lowStock.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-3 sm:px-2">
                  <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                  <b>{i.wood_name}</b><span className="text-sm text-muted-foreground">{i.size_note}</span>
                  <span className="ml-auto text-sm tabular-nums"><b>{i.on_hand_bf.toLocaleString("en-PH")}</b> of {i.reorder_level_bf.toLocaleString("en-PH")} bf reorder level</span>
                </li>
              ))}
            </RowList>
          )}
          <Link href="/owner/inventory" className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold underline-offset-4 hover:underline">Open Lumber & Inventory <ArrowRight className="size-4" aria-hidden /></Link>
        </section>
      </div>
    </OwnerShell>
  );
}
