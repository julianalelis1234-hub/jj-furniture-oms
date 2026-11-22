import { ListOrdered } from "lucide-react";
import Link from "next/link";
import { AppShell, Section } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";
import { DecideExceptionControls, InspectionControls, PriorityControls } from "@/components/office/actions";
import { OfficeWorkspace } from "@/components/office/office-workspace";
import { TaskCard } from "@/components/office/order-card";
import { ReviewProposalControls } from "@/components/office/spec-dialogs";
import { PriorityBadge, StatusBadge } from "@/components/status";
import { toClientOrder } from "@/lib/client-order";
import { formatDate, formatDateTime, todayISO } from "@/lib/domain/dates";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData, loadProposalSpecs, nameOf } from "@/lib/server/office-data";
import { isCustomerProposal } from "@/lib/services/exceptions";
import { riskOf } from "@/lib/services/insights";
import { productionQueue } from "@/lib/services/orders";
import { cn } from "@/lib/utils";

export const metadata = { title: "Shop Overview & Approvals" };

/** O-01 — the same 3-zone workspace plus the owner's decisions and the production priority board. */
export default async function OwnerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(["owner"]);
  const sp = await searchParams;
  const data = await loadOfficeData(await getStore());
  const today = todayISO();
  const byId = new Map(data.orders.map((o) => [o.id, toClientOrder(o)]));
  const queue = productionQueue(data.orders);
  const approvals = data.exceptions.filter((e) => e.status === "Pending" && ["Installment Approval", "Credit / Unpaid Balance", "Special Delivery Terms"].includes(e.category));
  const inspections = data.orders.filter((o) => o.status === "Completed / For Inspection");
  const proposals = data.exceptions.filter((e) => e.status === "Pending" && isCustomerProposal(e));
  const proposalSpecs = await loadProposalSpecs(await getStore(), proposals.map((e) => e.order_id));
  const unranked = data.orders.filter((o) => o.status === "Confirmed" && o.priority_rank === 99);
  const decisions = approvals.length + inspections.length + proposals.length;
  const openId = typeof sp.order === "string" ? sp.order : null;

  const decide = (
    <Section title="Awaiting your decision" count={decisions}>
      {decisions === 0 ? <p className="mb-2 rounded-2xl border border-dashed bg-card p-4 text-sm text-muted-foreground">Nothing needs your approval right now.</p> : (
        <ul className="grid gap-2 lg:grid-cols-2">
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
        </ul>
      )}
    </Section>
  );

  return (
    <AppShell portal="owner" actor={actor} live={<LiveSync />}>
      <OfficeWorkspace actor={actor} data={data} basePath="/owner" openId={openId} tab={typeof sp.tab === "string" ? sp.tab : undefined} between={decide}
        title="Shop Overview & Approvals" description={`${formatDate(today)} · live figures from the shared order record`} />
      <details className="mt-6 rounded-2xl border bg-card p-4" data-testid="planning-board">
        <summary className="flex cursor-pointer items-center gap-2 text-lg font-semibold">
          <ListOrdered className="size-5 text-primary" aria-hidden /> Planning Board · production priority
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">{queue.length + unranked.length}</span>
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">The order set here is exactly the order craftsmen see on their phones.</p>
        {unranked.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {unranked.map((o) => (
              <TaskCard key={o.id} order={byId.get(o.id)!} meta={<><b className="text-foreground">Set production priority</b> · confirmed, not yet ranked · due {formatDate(o.estimated_completion_date)}</>}
                actions={<PriorityControls order={byId.get(o.id)!} first={false} last={false} />} />
            ))}
          </ul>
        )}
        {queue.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No jobs in the workshop.</p> : (
          <ol className="mt-3 grid gap-2">
            {queue.map((o, i) => {
              const risk = riskOf(o, today);
              return (
                <li key={o.id} className={cn("rounded-xl border bg-background p-3", risk === "delayed" && "border-l-4 border-l-destructive", risk === "at_risk" && "border-l-4 border-l-warning")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">{i + 1}</span>
                    <Link href={`/owner?order=${o.id}`} scroll={false} className="font-bold hover:underline">{o.order_code}</Link>
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
      </details>
    </AppShell>
  );
}
