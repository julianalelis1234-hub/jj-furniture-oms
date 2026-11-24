import { AlertTriangle, ArrowRight, ClipboardList, Hammer, Plus, Sparkles, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DecideExceptionControls, InspectionControls } from "@/components/office/actions";
import { TaskCard } from "@/components/office/order-card";
import { ReviewProposalControls } from "@/components/office/spec-dialogs";
import { ActivityChart, DueBars } from "@/components/owner/dashboard-charts";
import { OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { StatusBadge } from "@/components/status";
import { toClientOrder } from "@/lib/client-order";
import { addDays, formatDate, formatDateTime, SHOP_TZ, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { formatDims } from "@/lib/domain/furniture";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext, loadProposalSpecs, nameOf } from "@/lib/server/office-data";
import { isCustomerProposal } from "@/lib/services/exceptions";
import { ownerKpis, riskOf, workspaceMetrics } from "@/lib/services/insights";
import { inventorySummary } from "@/lib/services/inventory";
import { cn } from "@/lib/utils";

export const metadata = { title: "Owner dashboard" };

const card = "rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgb(43_29_23/0.04)]";

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: SHOP_TZ }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
const firstName = (full: string) => full.replace(/^(mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0] ?? full;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const weekday = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(Date.parse(`${iso}T00:00:00Z`));

/** A KPI card: label, icon chip, big number, one supporting line. */
function KpiCard({ testid, label, value, sub, icon, tone = "muted" }: {
  testid: string; label: string; value: ReactNode; sub: ReactNode; icon: ReactNode; tone?: "good" | "warning" | "muted";
}) {
  return (
    <div className={cn(card, "flex min-w-0 flex-col gap-3 p-5")} data-testid={testid}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-muted-foreground">{label}</span>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-primary [&_svg]:size-4" aria-hidden>{icon}</span>
      </div>
      <span className="text-[2rem] leading-none font-extrabold tracking-[-0.03em] tabular-nums">{value}</span>
      <span className={cn("flex items-center gap-1 text-xs font-semibold", tone === "good" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground")}>{sub}</span>
    </div>
  );
}

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
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">{greeting(now)}, {firstName(actor.full_name)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: SHOP_TZ }).format(now)}
            {" · "}{decisions ? `${decisions} waiting for your decision` : "nothing waiting for your decision"}
          </p>
        </div>
        <Link href="/owner/orders" className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted">
          <ClipboardList className="size-4 text-primary" aria-hidden /> Orders & Quotations
        </Link>
        <Link href="/staff/new" className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90">
          <Plus className="size-4" aria-hidden /> New order
        </Link>
      </header>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpi-strip">
        <KpiCard testid="kpi-to-confirm" label="To confirm" value={m.toConfirm} icon={<ClipboardList />}
          sub={<><TrendingUp className="size-3.5" aria-hidden /> {newThisWeek} new in the last 7 days</>} tone={newThisWeek ? "good" : "muted"} />
        <KpiCard testid="kpi-workshop" label="In the workshop" value={m.inWorkshop} icon={<Hammer />}
          sub={`${k.waitingInspection} waiting for your inspection`} tone={k.waitingInspection ? "warning" : "muted"} />
        <KpiCard testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} icon={<Wallet />}
          sub="verified payments · active orders" tone="good" />
        <KpiCard testid="kpi-balances" label="Balances to collect" value={formatPeso(k.balancesToCollect)} icon={<Wallet />}
          sub={k.unpaidAfterDelivery.count ? `${formatPeso(k.unpaidAfterDelivery.amount)} unpaid after delivery` : "on active orders"}
          tone={k.unpaidAfterDelivery.count ? "warning" : "muted"} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={cn(card, "flex min-h-[22rem] min-w-0 flex-col p-5")} aria-label="Shop activity">
          <ActivityChart orderDays={orderDays} paymentDays={paymentDays} today={today} />
        </section>

        {/* the dark highlight card: this week in the workshop */}
        <section aria-labelledby="week-title" className="dark relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/10 bg-[#1e130e] p-5 text-[#faf6f0] shadow-[0_12px_32px_-12px_rgb(30_19_14/0.55)]">
          <span aria-hidden className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-[#c48a5a]/35 blur-3xl" />
          <div className="relative flex items-center gap-2">
            <Sparkles className="size-4 text-[#f0b27a]" aria-hidden />
            <h2 id="week-title" className="flex-1 text-sm font-bold">This week in the workshop</h2>
            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">Live</span>
          </div>
          <div className="relative">
            <p className="flex items-baseline gap-2"><b className="text-5xl leading-none font-extrabold tracking-[-0.03em] tabular-nums">{dueThisWeek}</b><span className="text-sm text-white/75">{dueThisWeek === 1 ? "job" : "jobs"} due in the next 7 days</span></p>
            <p className={cn("mt-1 text-xs font-semibold", k.delayedOrAtRisk ? "text-[#f3c77a]" : "text-[#9fd3a4]")} data-testid="kpi-late">
              {k.delayedOrAtRisk ? `${k.delayedOrAtRisk} delayed or at risk` : "Nothing delayed or at risk"}
            </p>
          </div>
          <div className="relative"><DueBars days={due} /></div>
          <dl className="relative grid grid-cols-3 gap-2 text-center">
            {[
              { id: "kpi-quote-payment", label: "Quote & payment", value: m.quotationAndPayment },
              { id: "kpi-delivery", label: "Ready / out", value: m.delivery },
              { id: "kpi-low-stock", label: "Low lumber", value: inv.lowStock.length },
            ].map((s) => (
              <div key={s.id} data-testid={s.id} className="rounded-xl bg-white/[0.07] px-2 py-2">
                <dt className="text-[11px] text-white/65">{s.label}</dt>
                <dd className="text-lg font-extrabold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="relative rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">{tip}</p>
          <div className="relative mt-auto flex gap-2">
            <a href="#decide-title" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#a86a3e] to-[#c48a5a] px-4 text-sm font-bold text-white hover:brightness-110">
              Review decisions
            </a>
            <Link href="/owner/craftsmen" className="inline-flex h-11 items-center rounded-full bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">Workshop</Link>
          </div>
        </section>
      </div>

      <section aria-labelledby="recent-title" className={cn(card, "mb-5 p-5")}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="recent-title" className="text-lg font-bold">Recent orders</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" aria-hidden /> {newThisWeek} new this week · {m.toConfirm} waiting for confirmation
          </span>
          <Link href="/owner/orders" className="ml-auto text-sm font-semibold text-primary underline-offset-4 hover:underline">View all</Link>
        </div>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {recent.map((o) => (
              <li key={o.id}>
                <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="flex h-full flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3.5 transition-colors hover:bg-accent-soft/60">
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

      <section aria-labelledby="decide-title" className={cn(card, "mb-5 scroll-mt-6 p-5")}>
        <h2 id="decide-title" className="mb-2 flex items-center gap-2 text-lg font-bold">
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

      <div className="grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="late-title" className={cn(card, "p-5")}>
          <h2 id="late-title" className="mb-2 text-lg font-bold">Delayed or at risk</h2>
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
        <section aria-labelledby="stock-title" className={cn(card, "p-5")}>
          <h2 id="stock-title" className="mb-2 text-lg font-bold">Lumber to reorder</h2>
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
