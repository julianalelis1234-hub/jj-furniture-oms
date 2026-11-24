import Link from "next/link";
import { ScheduleDeliveryDialog } from "@/components/office/actions";
import { DeliveryPill } from "@/components/delivery-pill";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { toClientOrder } from "@/lib/client-order";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext, nameOf } from "@/lib/server/office-data";

export const metadata = { title: "Deliveries" };

/** Deliveries: what to schedule, what is on the road, and what came back. */
export default async function OwnerDeliveries() {
  const actor = await requireActor(["owner"]);
  const { data, badges } = await loadOwnerContext(await getStore());
  const drivers = data.profiles.filter((p) => p.role === "driver" && p.is_active);
  const byId = new Map(data.orders.map((o) => [o.id, o]));
  const live = (id: string) => data.deliveries.some((d) => d.order_id === id && d.dispatch_status !== "Failed / Reschedule");
  const toSchedule = data.orders.filter((o) => o.status === "Ready for Delivery" && !live(o.id));
  const rank = { "Out for Delivery": 0, "Failed / Reschedule": 1, Scheduled: 2, Delivered: 3 } as const;
  const rows = [...data.deliveries].sort((a, b) => rank[a.dispatch_status] - rank[b.dispatch_status] || a.scheduled_date.localeCompare(b.scheduled_date));
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Deliveries" description="Riders, trips and the money each delivery collects." />
      <section aria-labelledby="sched-title" className="mb-10">
        <h2 id="sched-title" className="mb-3 text-2xl">Ready to schedule</h2>
        {toSchedule.length === 0 ? <p className="border-y border-border py-4 text-muted-foreground">Nothing waiting for a rider.</p> : (
          <RowList data-testid="to-schedule">
            {toSchedule.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 py-3 sm:px-3">
                <Link href={`/owner/orders?order=${o.id}`} scroll={false} className="font-bold tabular-nums hover:underline">{o.order_code}</Link>
                <span className="min-w-0 flex-1 text-sm">{o.item_name} · {o.municipality} <span className="text-muted-foreground">· collect {formatPeso(o.collectible_on_delivery)}</span></span>
                <ScheduleDeliveryDialog order={toClientOrder(o)} drivers={drivers} />
              </li>
            ))}
          </RowList>
        )}
      </section>
      <section aria-labelledby="trips-title">
        <h2 id="trips-title" className="mb-3 text-2xl">Trips</h2>
        <RowList data-testid="trips">
          {rows.map((d) => {
            const o = byId.get(d.order_id);
            return (
              <li key={d.id} className="grid gap-1 px-1 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-3">
                <span className="text-sm font-semibold tabular-nums">{formatDate(d.scheduled_date)}</span>
                <span className="min-w-0">
                  <Link href={`/owner/orders?order=${d.order_id}`} scroll={false} className="font-bold hover:underline">{o?.order_code ?? "—"}</Link>
                  <span className="text-sm"> · {o?.customer_name} · {o?.municipality}</span>
                  <span className="block text-sm text-muted-foreground">{nameOf(data.profiles, d.driver_id)} · {d.vehicle_type} · {d.time_window ?? "any time"} · collect {formatPeso(d.expected_collectible_amount)}</span>
                  {d.failure_or_damage_notes && <span className="block text-sm text-destructive">{d.failure_or_damage_notes}</span>}
                </span>
                <DeliveryPill status={d.dispatch_status} />
              </li>
            );
          })}
        </RowList>
      </section>
    </OwnerShell>
  );
}
