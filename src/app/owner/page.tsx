import { AlertTriangle, ArrowRight, ClipboardList, Clock, Hammer, Layers, Receipt, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { DecideExceptionControls, InspectionControls } from "@/components/office/actions";
import { Metric } from "@/components/office/office-workspace";
import { TaskCard } from "@/components/office/order-card";
import { ReviewProposalControls } from "@/components/office/spec-dialogs";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { toClientOrder } from "@/lib/client-order";
import { formatDate, formatDateTime, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext, loadProposalSpecs, nameOf } from "@/lib/server/office-data";
import { isCustomerProposal } from "@/lib/services/exceptions";
import { ownerKpis, riskOf, workspaceMetrics } from "@/lib/services/insights";
import { inventorySummary } from "@/lib/services/inventory";

export const metadata = { title: "Owner dashboard" };

/** O-01 · Dashboard: the shop at a glance, the owner's decisions, and what needs attention. */
export default async function OwnerDashboard() {
  const actor = await requireActor(["owner"]);
  const store = await getStore();
  const { data, lumberItems, lumberMovements, badges } = await loadOwnerContext(store);
  const today = todayISO();
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

  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Dashboard" description={`${formatDate(today)} · live figures from the shared order record`} />

      <div className="mb-10 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4" data-testid="kpi-strip">
        <Metric testid="kpi-to-confirm" label="To confirm" value={m.toConfirm} sub="new orders to check" icon={<ClipboardList />} />
        <Metric testid="kpi-quote-payment" label="Quotation & payment" value={m.quotationAndPayment} sub="confirmed, before production" icon={<Receipt />} />
        <Metric testid="kpi-workshop" label="In workshop" value={m.inWorkshop} sub={`${k.waitingInspection} waiting for your inspection`} icon={<Hammer />} />
        <Metric testid="kpi-delivery" label="Out / ready for delivery" value={m.delivery} sub={`${k.deliveriesToWatch} to watch today or tomorrow`} icon={<Truck />} />
        <Metric testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} sub="verified furniture payments · active orders" icon={<Wallet />} />
        <Metric testid="kpi-balances" label="Balances to collect" value={formatPeso(k.balancesToCollect)} sub={k.unpaidAfterDelivery.count ? `${formatPeso(k.unpaidAfterDelivery.amount)} unpaid after delivery` : "on active orders"} icon={<Wallet />} />
        <Metric testid="kpi-late" label="Delayed or at risk" value={k.delayedOrAtRisk} sub="past or near the completion date" icon={<Clock />} tone={k.delayedOrAtRisk ? "warning" : undefined} />
        <Metric testid="kpi-low-stock" label="Low lumber stock" value={inv.lowStock.length} sub={`${inv.totalOnHandBf.toLocaleString("en-PH")} board feet on hand`} icon={<Layers />} tone={inv.lowStock.length ? "warning" : undefined} />
      </div>

      <section aria-labelledby="decide-title" className="mb-10">
        <h2 id="decide-title" className="mb-3 flex items-center gap-2 text-2xl">
          Awaiting your decision <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-primary-foreground tabular-nums">{decisions}</span>
        </h2>
        {decisions === 0 ? <p className="border-y border-border py-4 text-muted-foreground">Nothing needs your approval right now.</p> : (
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

      <div className="grid gap-10 xl:grid-cols-2">
        <section aria-labelledby="late-title">
          <h2 id="late-title" className="mb-3 text-2xl">Delayed or at risk</h2>
          {late.length === 0 ? <p className="border-y border-border py-4 text-muted-foreground">Every job is on schedule.</p> : (
            <RowList data-testid="late-orders">
              {late.map((o) => {
                const r = riskOf(o, today);
                return (
                  <li key={o.id}>
                    <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-3 hover:bg-accent-soft/60 sm:px-3">
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
        <section aria-labelledby="stock-title">
          <h2 id="stock-title" className="mb-3 flex items-center gap-2 text-2xl">Lumber to reorder</h2>
          {inv.lowStock.length === 0 ? <p className="border-y border-border py-4 text-muted-foreground">All lumber is above its reorder level.</p> : (
            <RowList data-testid="low-stock">
              {inv.lowStock.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-3 sm:px-3">
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
