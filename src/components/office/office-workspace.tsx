import { ClipboardList, Hammer, Plus, Truck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/link-button";
import { OrderDrawer } from "@/components/office/order-drawer";
import { OrderQueue, type QueueRow } from "@/components/office/order-queue";
import { OrderWorkspace } from "@/components/office/order-workspace";
import { formatPeso, furniturePaidFrom } from "@/lib/domain/finance";
import { formatDims } from "@/lib/domain/furniture";
import type { Actor, Order, Payment } from "@/lib/domain/types";
import type { OfficeData } from "@/lib/server/office-data";
import { QUEUE_FILTERS, workspaceMetrics } from "@/lib/services/insights";

function accountOf(o: Order): QueueRow["account"] {
  if (o.has_no_email) return "walk-in";
  if (o.customer_user_id && o.email_verified_at) return "verified";
  if (o.customer_email) return "unverified";
  return "unlinked";
}

/** Queue rows without contact details (emails, phones and addresses stay in the drawer). */
export function queueRows(orders: Order[], payments: Payment[]): QueueRow[] {
  return orders.map((o) => {
    const paid = furniturePaidFrom(payments.filter((p) => p.order_id === o.id));
    return {
      id: o.id, code: o.order_code, created_at: o.created_at, customer: o.customer_name, account: accountOf(o),
      item: o.item_name, quantity: o.quantity, dims: formatDims(o) ?? null,
      material: `${o.wood_type === "Other" && o.custom_wood_note ? o.custom_wood_note : o.wood_type} · ${o.color_finish}`,
      status: o.status, price: o.furniture_price, verifiedPaid: paid, remaining: o.remaining_furniture_balance,
      down: o.standard_down_payment_due, deliveryFee: o.delivery_fee,
      pct: o.furniture_price ? Math.round((paid / o.furniture_price) * 100) : 0,
    };
  });
}

function Metric({ label, value, sub, icon, testid }: { label: string; value: ReactNode; sub: string; icon: ReactNode; testid: string }) {
  return (
    <div className="jj-surface flex items-start gap-3 rounded-2xl border bg-card p-4" data-testid={testid}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-live/40 bg-accent-soft text-primary [&_svg]:size-5" aria-hidden>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-muted-foreground">{label}</span>
        <span className="block text-2xl font-extrabold tabular-nums">{value}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </div>
  );
}

/**
 * The calm 3-zone office workspace shared by Staff (S-01) and Owner (O-01):
 *   1. title + primary action + 4 live metrics (computed from the actor's rows)
 *   2. stage filters + search + 5-column queue
 *   3. the selected order in a slide-over drawer (?order=<id>)
 */
export async function OfficeWorkspace({ actor, data, title, description, basePath, openId, tab, between }: {
  actor: Actor;
  data: OfficeData;
  title: string;
  description: string;
  basePath: string;
  openId?: string | null;
  tab?: string;
  /** owner-only blocks shown between the metrics and the queue */
  between?: ReactNode;
}) {
  const m = workspaceMetrics(data.orders, data.payments);
  const filters = QUEUE_FILTERS.map((f) => ({ key: f.key, label: f.label, statuses: f.statuses, count: m.filterCounts[f.key] }));
  const openOk = !!openId && data.orders.some((o) => o.id === openId);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
        <LinkButton href="/staff/new" variant="default" size="xl" className="rounded-full"><Plus aria-hidden /> New Walk-In / Phone Order</LinkButton>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpi-strip">
        <Metric testid="kpi-needs-quote" label="Needs quote / action" value={m.needsQuoteOrAction} sub="quote requests + awaiting acceptance" icon={<ClipboardList />} />
        <Metric testid="kpi-workshop" label="In workshop" value={m.inWorkshop} sub="confirmed, building or inspection" icon={<Hammer />} />
        <Metric testid="kpi-delivery" label="Out / ready for delivery" value={m.delivery} sub="ready or on the road" icon={<Truck />} />
        <Metric testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} sub="verified furniture payments · active orders" icon={<Wallet />} />
      </div>
      {between}
      <OrderQueue rows={queueRows(data.orders, data.payments)} filters={filters} basePath={basePath} openId={openOk ? openId : null} />
      {openOk && (
        <OrderDrawer closeHref={basePath}>
          <OrderWorkspace orderId={openId!} actor={actor} variant="drawer" initialTab={tab} />
        </OrderDrawer>
      )}
    </>
  );
}
