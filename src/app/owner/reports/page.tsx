import { BarChart3, CalendarCheck, PackageCheck, Timer, Wallet } from "lucide-react";
import { dashCard, KpiCard, KpiRow } from "@/components/dashboard";
import { cn } from "@/lib/utils";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { daysBetween, todayISO } from "@/lib/domain/dates";
import { formatPeso, furniturePaidFrom, money } from "@/lib/domain/finance";
import { PAYMENT_PLAN_LABEL } from "@/lib/domain/types";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";

export const metadata = { title: "Reports" };

/**
 * One single-hue bar per row, the value written beside it (the bar is only a
 * visual aid; hovering shows the same numbers). Sorted largest first.
 */
function BarList({ title, rows, unit, testid }: { title: string; rows: [string, number][]; unit: string; testid: string }) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  const total = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <section aria-labelledby={`${testid}-title`} data-testid={testid} className={cn(dashCard, "min-w-0 p-3.5 sm:p-5")}>
      <h2 id={`${testid}-title`} className="mb-2 text-base font-bold sm:mb-3 sm:text-lg">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No data yet.</p> : (
        <table className="w-full text-xs sm:text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="sr-only"><tr><th scope="col">Item</th><th scope="col">{unit}</th><th scope="col">Share</th></tr></thead>
          <tbody>
            {[...rows].sort((a, b) => b[1] - a[1]).map(([label, v]) => (
              <tr key={label} className="border-t border-border" title={`${label}: ${v.toLocaleString("en-PH")} ${unit} (${Math.round((v / Math.max(1, total)) * 100)}%)`}>
                <th scope="row" className="w-2/5 py-2 pr-3 text-left font-semibold sm:py-2.5">{label}</th>
                <td className="py-2.5">
                  <span className="flex items-center gap-3">
                    {/* a fixed-width track, so bar length is exactly proportional to the value */}
                    <span className="min-w-0 flex-1" aria-hidden>
                      <span className="block h-2.5 rounded-r-[4px] bg-primary sm:h-3" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
                    </span>
                    <span className="w-10 shrink-0 font-bold tabular-nums">{v.toLocaleString("en-PH")}</span>
                  </span>
                </td>
                <td className="w-14 py-2.5 text-right text-muted-foreground tabular-nums">{Math.round((v / Math.max(1, total)) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const count = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()];
};

/** Reports: the last 30 days in numbers, and what the shop builds. Computed from the live order record. */
export default async function OwnerReports() {
  const actor = await requireActor(["owner"]);
  const store = await getStore();
  const { data, badges } = await loadOwnerContext(store);
  const history = await store.listHistory();
  const now = Date.parse(`${todayISO()}T23:59:59Z`); // end of today (server clock)
  const since = now - 30 * 86_400_000;
  const in30 = (iso: string | null | undefined) => !!iso && Date.parse(iso) >= since;
  const received = data.orders.filter((o) => in30(o.created_at));
  const confirmed = data.orders.filter((o) => in30(o.confirmed_at));
  const deliveredAt = new Map<string, string>();
  for (const h of history) if (h.to_status === "Delivered" && h.from_status !== "Delivered") deliveredAt.set(h.order_id, h.changed_at);
  const delivered30 = [...deliveredAt.entries()].filter(([, at]) => in30(at));
  const leadDays = [...deliveredAt.entries()].map(([id, at]) => {
    const o = data.orders.find((x) => x.id === id);
    return o ? daysBetween(o.created_at.slice(0, 10), at.slice(0, 10)) : null;
  }).filter((d): d is number => d != null && d >= 0);
  const avgLead = leadDays.length ? Math.round(leadDays.reduce((s, d) => s + d, 0) / leadDays.length) : null;
  const paid30 = money(furniturePaidFrom(data.payments.filter((p) => in30(p.paid_at))));
  const built = data.orders.filter((o) => !["Quote Requested", "Waiting for Confirmation"].includes(o.status));
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Reports" description="The last 30 days, computed from the live order record. Only verified payments count as money in." />
      <KpiRow cols={5} testid="report-kpis">
        <KpiCard testid="rep-received" label="Orders received" value={received.length} sub="online and walk-in" icon={<BarChart3 />} />
        <KpiCard testid="rep-confirmed" label="Orders confirmed" value={confirmed.length} sub="by the shop" icon={<CalendarCheck />} />
        <KpiCard testid="rep-delivered" label="Delivered" value={delivered30.length} sub="handed to the customer" icon={<PackageCheck />} tone="good" />
        <KpiCard testid="rep-paid" label="Verified payments" value={formatPeso(paid30)} sub="furniture payments, 30 days" icon={<Wallet />} tone="good" />
        <KpiCard testid="rep-lead" label="Average lead time" value={avgLead == null ? "—" : `${avgLead} days`} sub="order to delivery, all time" icon={<Timer />} />
      </KpiRow>
      <div className="grid gap-3 sm:gap-5 xl:grid-cols-2">
        <BarList testid="rep-category" title="Confirmed orders by furniture type" unit="orders" rows={count(built, (o) => o.furniture_category ?? "Not specified")} />
        <BarList testid="rep-wood" title="Confirmed orders by wood" unit="orders" rows={count(built, (o) => (o.wood_type === "Other" ? o.custom_wood_note || "Other wood" : o.wood_type))} />
        <BarList testid="rep-plan" title="Payment terms chosen" unit="orders" rows={count(data.orders.filter((o) => o.payment_plan), (o) => PAYMENT_PLAN_LABEL[o.payment_plan!])} />
        <BarList testid="rep-municipality" title="Confirmed orders by municipality" unit="orders" rows={count(built, (o) => o.municipality)} />
      </div>
    </OwnerShell>
  );
}
