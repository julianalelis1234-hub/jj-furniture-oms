import { AlertTriangle, Hammer, PackageCheck, Users } from "lucide-react";
import Link from "next/link";
import { CardSection, chip, dashCard, KpiCard, KpiRow, PersonCard } from "@/components/dashboard";
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

      <KpiRow>
        <KpiCard label="Craftsmen" value={craftsmen.length} icon={<Users />} sub="active in the workshop" />
        <KpiCard label="In production" value={data.orders.filter((o) => o.status === "In Production").length} icon={<Hammer />} sub="being built now" tone="good" />
        <KpiCard label="For inspection" value={data.orders.filter((o) => o.status === "Completed / For Inspection").length} icon={<PackageCheck />} sub="waiting for your check" />
        <KpiCard label="Delayed" value={queue.filter((o) => riskOf(o, today) === "delayed").length} icon={<AlertTriangle />} sub="past the completion date"
          tone={queue.some((o) => riskOf(o, today) === "delayed") ? "warning" : "good"} />
      </KpiRow>

      <CardSection id="load" title="Workload">
        <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3" data-testid="craftsman-load">
          {craftsmen.map((c) => {
            const mine = jobs(c.id);
            const late = mine.filter((o) => riskOf(o, today) === "delayed").length;
            return (
              <PersonCard key={c.id} name={c.full_name} line={mine.length === 0 ? "No active job" : mine.map((o) => o.order_code).join(" · ")}
                chips={<>
                  <span className={chip}>{mine.length} active</span>
                  {late > 0 && <span className={cn(chip, "bg-destructive/10 text-destructive")}>{late} delayed</span>}
                </>} />
            );
          })}
        </ul>
      </CardSection>

      <CardSection id="assign" title="Assign jobs" chip="Released after the verified 30%">
        {assignable.length === 0 ? <p className="text-sm text-muted-foreground">No jobs to assign.</p> : (
          <RowList>
            {assignable.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 py-2.5 sm:px-2 sm:py-3">
                <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="text-sm font-bold tabular-nums hover:underline sm:text-base">{o.order_code}</Link>
                <span className="min-w-0 flex-1 text-xs sm:text-sm">{o.quantity} × {o.item_name} <span className="text-muted-foreground">· due {formatDate(o.estimated_completion_date)}</span></span>
                <StatusBadge status={o.status} />
                <AssignCraftsmanSelect order={toClientOrder(o)} craftsmen={craftsmen} />
              </li>
            ))}
          </RowList>
        )}
      </CardSection>

      <section aria-labelledby="plan-title" data-testid="planning-board" className={cn(dashCard, "p-3.5 sm:p-5")}>
        <h2 id="plan-title" className="text-base font-bold sm:text-lg">Production priority</h2>
        <p className="mb-3 text-xs text-muted-foreground sm:text-sm">The order set here is exactly the order craftsmen see on their phones.</p>
        {queue.length === 0 ? <p className="text-sm text-muted-foreground">No jobs in the workshop.</p> : (
          <ol className="divide-y divide-border border-y border-border">
            {queue.map((o, i) => {
              const risk = riskOf(o, today);
              return (
                <li key={o.id} className={cn("grid gap-2 border-l-4 border-l-transparent py-3 pl-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center", risk === "delayed" && "border-l-destructive", risk === "at_risk" && "border-l-warning")}>
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground tabular-nums sm:size-9 sm:text-sm">{i + 1}</span>
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
