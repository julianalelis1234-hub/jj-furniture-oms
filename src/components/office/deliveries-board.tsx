import { CalendarClock, CircleAlert, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { CardSection, DarkCard, DarkFigure, DarkStats, KpiCard, KpiRow } from "@/components/dashboard";
import { DeliveryPill } from "@/components/delivery-pill";
import { ScheduleDeliveryDialog } from "@/components/office/actions";
import { RowList } from "@/components/rows";
import { toClientOrder } from "@/lib/client-order";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { nameOf, type OfficeData } from "@/lib/server/office-data";

/** Deliveries for the office (owner and staff): what to schedule, who is on the road, and every trip. */
export function DeliveriesBoard({ data, ordersPath }: { data: OfficeData; ordersPath: string }) {
  const drivers = data.profiles.filter((p) => p.role === "driver" && p.is_active);
  const byId = new Map(data.orders.map((o) => [o.id, o]));
  const live = (id: string) => data.deliveries.some((d) => d.order_id === id && d.dispatch_status !== "Failed / Reschedule");
  const toSchedule = data.orders.filter((o) => o.status === "Ready for Delivery" && !live(o.id));
  const rank = { "Out for Delivery": 0, "Failed / Reschedule": 1, Scheduled: 2, Delivered: 3 } as const;
  const rows = [...data.deliveries].sort((a, b) => rank[a.dispatch_status] - rank[b.dispatch_status] || a.scheduled_date.localeCompare(b.scheduled_date));
  const by = (s: keyof typeof rank) => data.deliveries.filter((d) => d.dispatch_status === s);
  const onRoad = by("Out for Delivery");
  const toCollect = [...onRoad, ...by("Scheduled")].reduce((s, d) => s + d.expected_collectible_amount, 0);
  const orderHref = (id: string) => `${ordersPath}?order=${id}`;
  return (
    <>
      <KpiRow>
        <KpiCard label="To schedule" value={toSchedule.length} icon={<CalendarClock />} sub="ready, no rider yet" tone={toSchedule.length ? "warning" : "muted"} />
        <KpiCard label="On the road" value={onRoad.length} icon={<Truck />} sub={`${by("Scheduled").length} more scheduled`} tone={onRoad.length ? "good" : "muted"} />
        <KpiCard label="Delivered" value={by("Delivered").length} icon={<PackageCheck />} sub="all time" tone="good" />
        <KpiCard label="Failed" value={by("Failed / Reschedule").length} icon={<CircleAlert />} sub="to reschedule" tone={by("Failed / Reschedule").length ? "warning" : "muted"} />
      </KpiRow>

      <div className="mb-3 grid gap-3 sm:mb-5 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <CardSection id="sched" title="Ready to schedule" className="mb-0 sm:mb-0">
          {toSchedule.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting for a rider.</p> : (
            <RowList data-testid="to-schedule">
              {toSchedule.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 py-2.5 sm:px-2 sm:py-3">
                  <Link href={orderHref(o.id)} scroll={false} className="text-sm font-bold tabular-nums hover:underline sm:text-base">{o.order_code}</Link>
                  <span className="min-w-0 flex-1 text-xs sm:text-sm">{o.item_name} · {o.municipality} <span className="text-muted-foreground">· collect {formatPeso(o.collectible_on_delivery)}</span></span>
                  <ScheduleDeliveryDialog order={toClientOrder(o)} drivers={drivers} />
                </li>
              ))}
            </RowList>
          )}
        </CardSection>
        <DarkCard id="road-title" title="Riders today">
          <DarkFigure value={onRoad.length} caption={onRoad.length === 1 ? "trip on the road" : "trips on the road"}
            note={`${formatPeso(toCollect)} to collect on open trips`} noteTone="good" />
          <DarkStats items={[
            { label: "Riders", value: drivers.length },
            { label: "Scheduled", value: by("Scheduled").length },
            { label: "Failed", value: by("Failed / Reschedule").length },
          ]} />
        </DarkCard>
      </div>

      <CardSection id="trips" title="Trips" chip="On the road first">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No trips yet.</p> : (
          <RowList data-testid="trips">
            {rows.map((d) => {
              const o = byId.get(d.order_id);
              return (
                <li key={d.id} className="grid gap-1 px-1 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-2 sm:py-3">
                  <span className="text-xs font-semibold tabular-nums sm:text-sm">{formatDate(d.scheduled_date)}</span>
                  <span className="min-w-0">
                    <Link href={orderHref(d.order_id)} scroll={false} className="text-sm font-bold hover:underline sm:text-base">{o?.order_code ?? "—"}</Link>
                    <span className="text-xs sm:text-sm"> · {o?.customer_name} · {o?.municipality}</span>
                    <span className="block text-xs text-muted-foreground sm:text-sm">{nameOf(data.profiles, d.driver_id)} · {d.vehicle_type} · {d.time_window ?? "any time"} · collect {formatPeso(d.expected_collectible_amount)}</span>
                    {d.failure_or_damage_notes && <span className="block text-xs text-destructive sm:text-sm">{d.failure_or_damage_notes}</span>}
                  </span>
                  <DeliveryPill status={d.dispatch_status} />
                </li>
              );
            })}
          </RowList>
        )}
      </CardSection>
    </>
  );
}
