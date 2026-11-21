import {
  AlertTriangle,
  ClipboardList,
  Hammer,
  HandCoins,
  Plus,
  SearchCheck,
  ShieldAlert,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell, EmptyState, PageTitle, Section } from "@/components/app-shell";
import { DesignNote } from "@/components/design-note";
import { LinkButton } from "@/components/link-button";
import {
  AnswerQuestionDialog,
  DecideExceptionControls,
  InspectionControls,
  PriorityControls,
  ResolveRepairDialog,
  RetrySmsDialog,
} from "@/components/office/actions";
import { TaskCard } from "@/components/office/order-card";
import { OrdersTable } from "@/components/office/orders-table";
import { PriorityBadge, StatusBadge } from "@/components/status";
import { toClientOrder } from "@/lib/client-order";
import { formatDate, formatDateTime, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData, loadProposalSpecs, nameOf } from "@/lib/server/office-data";
import { ReviewProposalControls } from "@/components/office/spec-dialogs";
import { isCustomerProposal } from "@/lib/services/exceptions";
import { ownerKpis, riskOf } from "@/lib/services/insights";
import { productionQueue } from "@/lib/services/orders";
import { SMS_SIMULATED_NOTE, smsMode } from "@/lib/services/notify";
import { cn } from "@/lib/utils";

export const metadata = { title: "Owner Dashboard" };

function Kpi({ label, value, icon, tone = "default", sub }: { label: string; value: ReactNode; icon: ReactNode; tone?: "default" | "danger" | "warning"; sub?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3 sm:p-4", tone === "danger" && "border-destructive/60 bg-danger-soft", tone === "warning" && "border-warning/60 bg-warning-soft")}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{icon}{label}</div>
      <p className="mt-1 text-2xl font-black tabular-nums sm:text-3xl">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function OwnerPage() {
  const actor = await requireActor(["owner"]);
  const data = await loadOfficeData(await getStore());
  const today = todayISO();
  const k = ownerKpis(data.orders, data.deliveries, data.exceptions, today);
  const byId = new Map(data.orders.map((o) => [o.id, toClientOrder(o)]));
  const queue = productionQueue(data.orders);

  const approvals = data.exceptions.filter((e) => e.status === "Pending" && ["Installment Approval", "Credit / Unpaid Balance", "Special Delivery Terms"].includes(e.category));
  const inspections = data.orders.filter((o) => o.status === "Completed / For Inspection");
  const questions = data.exceptions.filter((e) => e.status === "Pending" && e.category === "Spec Clarification" && !isCustomerProposal(e));
  const proposals = data.exceptions.filter((e) => e.status === "Pending" && isCustomerProposal(e));
  const proposalSpecs = await loadProposalSpecs(await getStore(), proposals.map((e) => e.order_id));
  const repairs = data.exceptions.filter((e) => e.status === "Pending" && e.category === "On-Site Scratch Touch-Up / Repair");
  const failedSms = data.notifications.filter((n) => n.delivery_status === "Failed");
  const unranked = data.orders.filter((o) => o.status === "Confirmed" && o.priority_rank === 99);
  const attention = proposals.length + approvals.length + inspections.length + questions.length + repairs.length + failedSms.length + unranked.length;
  const watch = data.deliveries.filter((d) => d.dispatch_status === "Failed / Reschedule" || d.dispatch_status === "Out for Delivery" || (d.dispatch_status === "Scheduled" && d.scheduled_date <= today));

  return (
    <AppShell portal="owner" actor={actor}>
      <PageTitle
        title={`Magandang araw, ${actor.full_name.replace(/^Mr\.\s*/, "").split(" ")[0]}`}
        description={`${formatDate(today)} · live figures from the shared order record`}
        actions={<div className="flex gap-2"><LinkButton href="/staff">Staff view</LinkButton><LinkButton href="/staff/new" variant="default"><Plus aria-hidden /> New Order</LinkButton></div>}
      />

      <div className="mb-6 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Kpi label="Active Orders" value={k.activeOrders} icon={<ClipboardList className="size-4" />} />
        <Kpi label="Delayed / At Risk" value={k.delayedOrAtRisk} icon={<AlertTriangle className="size-4" />} tone={k.delayedOrAtRisk ? "danger" : "default"} />
        <Kpi label="In Production" value={k.inProduction} icon={<Hammer className="size-4" />} />
        <Kpi label="Waiting Inspection" value={k.waitingInspection} icon={<SearchCheck className="size-4" />} tone={k.waitingInspection ? "warning" : "default"} />
        <Kpi label="Deliveries to Watch" value={k.deliveriesToWatch} icon={<Truck className="size-4" />} tone={k.deliveriesToWatch ? "warning" : "default"} />
        <Kpi label="Balances Still to Collect" value={formatPeso(k.balancesToCollect)} icon={<Wallet className="size-4" />} sub="active orders, incl. delivery fees" />
        <Kpi label="Unpaid After Delivery" value={formatPeso(k.unpaidAfterDelivery.amount)} icon={<HandCoins className="size-4" />} tone={k.unpaidAfterDelivery.count ? "danger" : "default"} sub={`${k.unpaidAfterDelivery.count} order(s)`} />
        <Kpi label="Approvals Waiting" value={k.approvalsWaiting} icon={<ShieldAlert className="size-4" />} tone={k.approvalsWaiting ? "warning" : "default"} />
      </div>
      <DesignNote className="mb-6">The eight cards answer the owner&apos;s interview questions: “What is late? Who still owes us? What needs my decision?” Each card is backed by live database queries.</DesignNote>

      <div className="grid gap-x-6 lg:grid-cols-[1.1fr_1fr]">
        <Section title="Needs your attention" count={attention}>
          {attention === 0 ? <EmptyState title="Nothing needs your decision right now" /> : (
            <ul className="grid gap-2">
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
              {questions.map((e) => {
                const o = byId.get(e.order_id); if (!o) return null;
                return <TaskCard key={e.id} order={o} tone="info" meta={<><b className="text-foreground">Spec question</b> · “{e.description}” — {e.requested_by}</>} actions={<AnswerQuestionDialog ex={e} orderCode={o.order_code} />} />;
              })}
              {repairs.map((e) => {
                const o = byId.get(e.order_id); if (!o) return null;
                return <TaskCard key={e.id} order={o} tone="danger" meta={<><b className="text-foreground">Touch-up / repair</b> · {e.description} — {e.requested_by}</>} actions={<ResolveRepairDialog ex={e} orderCode={o.order_code} />} />;
              })}
              {failedSms.map((n) => {
                const o = byId.get(n.order_id); if (!o) return null;
                return <TaskCard key={n.id} order={o} tone="danger" meta={<><b className="text-foreground">SMS failed: Number not reachable</b>{smsMode() === "simulated" ? ` ${SMS_SIMULATED_NOTE}` : ""} ({n.recipient_phone})</>} actions={<RetrySmsDialog n={n} />} />;
              })}
              {unranked.map((o) => (
                <TaskCard key={o.id} order={byId.get(o.id)!} meta={<><b className="text-foreground">Set production priority</b> · confirmed, not yet ranked · due {formatDate(o.estimated_completion_date)}</>}
                  actions={<PriorityControls order={byId.get(o.id)!} first={false} last={false} />} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Planning Board · production priority" count={queue.length}>
          <DesignNote className="mb-2">The order set here is exactly the order craftsmen see on their phones, replacing verbal “unahon ni” (do this first) instructions.</DesignNote>
          {queue.length === 0 ? <EmptyState title="No jobs in the workshop" /> : (
            <ol className="grid gap-2">
              {queue.map((o, i) => {
                const risk = riskOf(o, today);
                return (
                  <li key={o.id} className={cn("rounded-xl border bg-card p-3", risk === "delayed" && "border-l-4 border-l-destructive", risk === "at_risk" && "border-l-4 border-l-warning")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-sm font-black text-background">{i + 1}</span>
                      <Link href={`/staff/orders/${o.id}`} className="font-bold hover:underline">{o.order_code}</Link>
                      <PriorityBadge label={o.priority_label} />
                      <StatusBadge status={o.status} className="ml-auto" />
                    </div>
                    <p className="mt-1 text-sm">{o.quantity} × {o.item_name} · {nameOf(data.profiles, o.assigned_craftsman_id)}</p>
                    <p className={cn("text-xs", risk === "delayed" ? "font-bold text-destructive" : risk === "at_risk" ? "font-semibold text-warning" : "text-muted-foreground")}>
                      {risk === "delayed" ? "DELAYED · " : risk === "at_risk" ? "AT RISK · " : ""}due {formatDate(o.estimated_completion_date)}
                    </p>
                    <div className="mt-2"><PriorityControls order={byId.get(o.id)!} first={i === 0} last={i === queue.length - 1} /></div>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      </div>

      <Section title="Deliveries to watch" count={watch.length}>
        {watch.length === 0 ? <EmptyState title="No deliveries today" /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {watch.map((d) => {
              const o = byId.get(d.order_id); if (!o) return null;
              return <TaskCard key={d.id} order={o} tone={d.dispatch_status === "Failed / Reschedule" ? "danger" : "info"}
                meta={<><b className="text-foreground">{d.dispatch_status}</b> · {formatDate(d.scheduled_date)} {d.time_window} · {nameOf(data.profiles, d.driver_id)} ({d.vehicle_type}) · collect {formatPeso(o.collectible_on_delivery)}{d.failure_or_damage_notes ? ` · ${d.failure_or_damage_notes}` : ""}</>} />;
            })}
          </ul>
        )}
      </Section>

      <Section title="All orders"><OrdersTable orders={data.orders.map(toClientOrder)} /></Section>
    </AppShell>
  );
}
