import { CalendarDays, CheckCircle2, MapPin, Truck, Wallet } from "lucide-react";
import {
  CardSection, DarkCard, DarkFigure, DarkStats, DashboardHeader, darkPrimary, dashCard, KpiCard, KpiRow,
} from "@/components/dashboard";
import { PortalShell } from "@/components/portal-shell";
import { formatDate, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { driverManifest } from "@/lib/services/deliveries";
import { cn } from "@/lib/utils";
import { DriverApp } from "./driver-app";

export const metadata = { title: "Deliveries" };

/** D-01 — dashboard: greeting, stop counts, next stop beside today's route, then the offline-ready delivery app. */
export default async function DriverPage() {
  const actor = await requireActor(["driver"]);
  // Only this driver's assignments (RLS in production; service check everywhere).
  const manifest = await driverManifest(await getStore(), actor);
  const now = new Date();
  const today = todayISO(now);
  const done = (s: string) => s === "Delivered" || s === "Failed / Reschedule";
  const todays = manifest.filter((e) => !done(e.delivery.dispatch_status) && e.delivery.scheduled_date <= today)
    .sort((a, b) => a.delivery.scheduled_date.localeCompare(b.delivery.scheduled_date) || (a.delivery.time_window ?? "").localeCompare(b.delivery.time_window ?? ""));
  const upcoming = manifest.filter((e) => !done(e.delivery.dispatch_status) && e.delivery.scheduled_date > today);
  const delivered = manifest.filter((e) => e.delivery.dispatch_status === "Delivered");
  const failed = manifest.filter((e) => e.delivery.dispatch_status === "Failed / Reschedule");
  const onTheRoad = todays.filter((e) => e.delivery.dispatch_status === "Out for Delivery").length;
  const toCollect = todays.reduce((s, e) => s + (e.delivery.expected_collectible_amount ?? 0), 0);
  const next = todays.find((e) => e.delivery.dispatch_status === "Out for Delivery") ?? todays[0] ?? upcoming[0] ?? null;
  const tip = todays.length
    ? `Pre-load your assignments before leaving the shop. Roads to Lantapan, Cabanglasan and Pangantucan lose signal.`
    : upcoming.length ? `No stops today. Your next trip is on ${formatDate(upcoming[0].delivery.scheduled_date)}.` : "No trips assigned. The office will schedule the next one.";

  return (
    <PortalShell portal="driver" actor={actor} live={{ mode: "event" }}>
      <DashboardHeader name={actor.full_name} now={now}
        summary={todays.length ? `${todays.length} ${todays.length === 1 ? "stop" : "stops"} today` : "no stops today"} />

      <KpiRow>
        <KpiCard label="Today's stops" value={todays.length} icon={<MapPin />} sub={onTheRoad ? `${onTheRoad} on the road now` : "not started yet"} tone={onTheRoad ? "good" : "muted"} />
        <KpiCard label="Upcoming" value={upcoming.length} icon={<CalendarDays />} sub="scheduled after today" />
        <KpiCard label="Delivered" value={delivered.length} icon={<CheckCircle2 />} sub={failed.length ? `${failed.length} to reschedule` : "no failed trips"} tone={failed.length ? "warning" : "good"} />
        <KpiCard label="To collect today" value={formatPeso(toCollect)} icon={<Wallet />} sub="cash on delivery, today's stops" />
      </KpiRow>

      <div className="mb-3 sm:mb-5 grid gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="next-stop-title" className={cn(dashCard, "min-w-0 p-3.5 sm:p-5")}>
          <h2 id="next-stop-title" className="mb-3 sm:mb-4 text-base font-bold sm:text-lg">Next stop</h2>
          {!next ? <p className="text-sm text-muted-foreground">No deliveries assigned to you.</p> : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-lg sm:text-xl">{next.order.customer_name}</b>
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-primary">
                  {next.delivery.dispatch_status === "Out for Delivery" ? "In transit" : "On process"}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
                {[
                  ["Address", `${next.order.delivery_address}, ${next.order.municipality}`],
                  ["When", `${formatDate(next.delivery.scheduled_date)}${next.delivery.time_window ? ` · ${next.delivery.time_window}` : ""}`],
                  ["Item", `${next.order.quantity} × ${next.order.item_name}`],
                  ["Collect", formatPeso(next.delivery.expected_collectible_amount)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/50 p-2.5 sm:rounded-xl sm:p-3">
                    <dt className="text-xs font-semibold text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 text-sm font-bold break-words sm:text-base">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted-foreground">Open it under My deliveries to start the trip, mark it delivered or report a problem.</p>
            </div>
          )}
        </section>

        <DarkCard id="route-title" title="Today's route">
          <DarkFigure value={todays.length} caption={`${todays.length === 1 ? "stop" : "stops"} to make`}
            note={failed.length ? `${failed.length} failed ${failed.length === 1 ? "trip" : "trips"} to reschedule` : "No failed trips"} noteTone={failed.length ? "warning" : "good"} />
          <DarkStats items={[
            { label: "In transit", value: onTheRoad },
            { label: "Delivered", value: delivered.length },
            { label: "Upcoming", value: upcoming.length },
          ]} />
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">{tip}</p>
          <div className="mt-auto flex gap-2">
            <a href="#stops" className={darkPrimary}><Truck className="size-4" aria-hidden /> Open my deliveries</a>
          </div>
        </DarkCard>
      </div>

      <CardSection id="stops" title="My deliveries" chip="Works offline">
        <DriverApp driverId={actor.id} initialManifest={manifest} serverTime={now.toISOString()} />
      </CardSection>
    </PortalShell>
  );
}
