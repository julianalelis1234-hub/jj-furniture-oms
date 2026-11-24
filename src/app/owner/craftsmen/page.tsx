import Link from "next/link";
import { AssignCraftsmanSelect, PriorityControls } from "@/components/office/actions";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { PriorityBadge, StatusBadge } from "@/components/status";
import { toClientOrder } from "@/lib/client-order";
import { formatDate, todayISO } from "@/lib/domain/dates";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";
import { riskOf } from "@/lib/services/insights";
import { productionQueue } from "@/lib/services/orders";
import { cn } from "@/lib/utils";

export const metadata = { title: "Craftsmen" };

/** Who builds what: workload per craftsman, job assignment and the production priority order. */
export default async function OwnerCraftsmen() {
  const actor = await requireActor(["owner"]);
  const { data, badges } = await loadOwnerContext(await getStore());
  const today = todayISO();
  const craftsmen = data.profiles.filter((p) => p.role === "craftsman" && p.is_active);
  const queue = productionQueue(data.orders);
  const jobs = (id: string) => data.orders.filter((o) => o.assigned_craftsman_id === id && ["In Production", "Completed / For Inspection"].includes(o.status));
  const assignable = data.orders.filter((o) => (o.status === "Confirmed" && o.specs_confirmed) || o.status === "In Production");
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Craftsmen" description="Workload, job assignment and the order craftsmen see their jobs in." />

      <section aria-labelledby="load-title" className="mb-10">
        <h2 id="load-title" className="mb-3 text-2xl">Workload</h2>
        <RowList data-testid="craftsman-load">
          {craftsmen.map((c) => {
            const mine = jobs(c.id);
            const late = mine.filter((o) => riskOf(o, today) === "delayed").length;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-3 sm:px-3">
                <b className="min-w-40">{c.full_name}</b>
                <span className="text-sm text-muted-foreground">{mine.length === 0 ? "No active job" : mine.map((o) => o.order_code).join(" · ")}</span>
                <span className="ml-auto flex gap-2">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold tabular-nums">{mine.length} active</span>
                  {late > 0 && <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive">{late} delayed</span>}
                </span>
              </li>
            );
          })}
        </RowList>
      </section>

      <section aria-labelledby="assign-title" className="mb-10">
        <h2 id="assign-title" className="mb-1 text-2xl">Assign jobs</h2>
        <p className="mb-3 text-sm text-muted-foreground">Accepted orders and jobs in production. A job is released to the workshop only after the 30% down payment is verified.</p>
        {assignable.length === 0 ? <p className="border-y border-border py-4 text-muted-foreground">No jobs to assign.</p> : (
          <RowList>
            {assignable.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 py-3 sm:px-3">
                <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="font-bold tabular-nums hover:underline">{o.order_code}</Link>
                <span className="min-w-0 flex-1 text-sm">{o.quantity} × {o.item_name} <span className="text-muted-foreground">· due {formatDate(o.estimated_completion_date)}</span></span>
                <StatusBadge status={o.status} />
                <AssignCraftsmanSelect order={toClientOrder(o)} craftsmen={craftsmen} />
              </li>
            ))}
          </RowList>
        )}
      </section>

      <section aria-labelledby="plan-title" data-testid="planning-board">
        <h2 id="plan-title" className="mb-1 text-2xl">Production priority</h2>
        <p className="mb-3 text-sm text-muted-foreground">The order set here is exactly the order craftsmen see on their phones.</p>
        {queue.length === 0 ? <p className="border-y border-border py-4 text-muted-foreground">No jobs in the workshop.</p> : (
          <ol className="divide-y divide-border border-y border-border">
            {queue.map((o, i) => {
              const risk = riskOf(o, today);
              return (
                <li key={o.id} className={cn("grid gap-2 border-l-4 border-l-transparent py-3 pl-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center", risk === "delayed" && "border-l-destructive", risk === "at_risk" && "border-l-warning")}>
                  <span className="flex size-9 items-center justify-center rounded-full bg-foreground text-sm font-black text-background tabular-nums">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="font-bold hover:underline">{o.order_code}</Link>
                      <PriorityBadge label={o.priority_label} /><StatusBadge status={o.status} />
                    </span>
                    <span className={cn("block text-sm", risk === "delayed" ? "font-bold text-destructive" : risk === "at_risk" ? "font-semibold text-warning" : "text-muted-foreground")}>
                      {o.quantity} × {o.item_name} · {craftsmen.find((c) => c.id === o.assigned_craftsman_id)?.full_name ?? "not assigned"} · {risk === "delayed" ? "delayed, " : risk === "at_risk" ? "at risk, " : ""}due {formatDate(o.estimated_completion_date)}
                    </span>
                  </span>
                  <PriorityControls order={toClientOrder(o)} first={i === 0} last={i === queue.length - 1} />
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </OwnerShell>
  );
}
