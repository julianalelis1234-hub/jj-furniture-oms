import { ClipboardList, Hammer, Plus, Receipt, Truck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/link-button";
import { OrderDrawer } from "@/components/office/order-drawer";
import { OrderQueue, type QueueRow } from "@/components/office/order-queue";
import { OrderWorkspace } from "@/components/office/order-workspace";
import { formatDate, formatDateTime, todayISO } from "@/lib/domain/dates";
import { formatPeso, furniturePaidFrom, money } from "@/lib/domain/finance";
import { installmentSchedule } from "@/lib/domain/installments";
import { PAYMENT_PLAN_LABEL } from "@/lib/domain/types";
import { verifierName } from "@/lib/server/office-data";
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
export function queueRows(orders: Order[], payments: Payment[], profiles: { id: string; full_name: string }[] = []): QueueRow[] {
  const today = todayISO();
  return orders.map((o) => {
    const mine = payments.filter((p) => p.order_id === o.id);
    const paid = furniturePaidFrom(mine);
    // the latest verified payment: who verified it and when
    const last = mine.filter((p) => p.verified_by_owner_or_staff).sort((a, b) => (b.verified_at ?? b.paid_at).localeCompare(a.verified_at ?? a.paid_at))[0];
    const schedule = installmentSchedule(o, paid, today);
    const next = schedule?.find((r) => r.state !== "paid");
    const plan = o.payment_plan === "installment"
      ? schedule
        ? `Installment · ${o.installment_count} × ${formatPeso(schedule[1].amount)} every 15 days${next ? ` · next ${next.due ? formatDate(next.due) : "down payment"}: ${formatPeso(money(next.amount - next.paid))}${next.state === "overdue" ? " (overdue)" : ""}` : " · fully paid"}`
        : "Installment · plan not set yet"
      : o.payment_plan ? PAYMENT_PLAN_LABEL[o.payment_plan] : null;
    return {
      plan,
      lastVerified: last ? `Verified by ${verifierName(last, profiles)}${last.verified_at ? ` · ${formatDateTime(last.verified_at)}` : ""}` : null,
      id: o.id, code: o.order_code, created_at: o.created_at, customer: o.customer_name, account: accountOf(o),
      item: o.item_name, quantity: o.quantity, dims: formatDims(o) ?? null,
      material: `${o.wood_type === "Other" && o.custom_wood_note ? o.custom_wood_note : o.wood_type} · ${o.color_finish}`,
      status: o.status, price: o.furniture_price, verifiedPaid: paid, remaining: o.remaining_furniture_balance,
      down: o.standard_down_payment_due, deliveryFee: o.delivery_fee,
      pct: o.furniture_price ? Math.round((paid / o.furniture_price) * 100) : 0,
    };
  });
}

/** A flat KPI: hairline on top, big number, no card. Exported for the owner dashboard. */
export function Metric({ label, value, sub, icon, testid, tone }: { label: string; value: ReactNode; sub: string; icon: ReactNode; testid: string; tone?: "warning" | "danger" }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 border-t-2 pt-3", tone === "danger" ? "border-destructive" : tone === "warning" ? "border-warning" : "border-foreground/80")} data-testid={testid}>
      <span className="mt-1 shrink-0 text-primary [&_svg]:size-5" aria-hidden>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-muted-foreground">{label}</span>
        <span className="block text-3xl leading-tight font-extrabold tracking-[-0.02em] tabular-nums">{value}</span>
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
export async function OfficeWorkspace({ actor, data, title, description, basePath, openId, tab, between, intro = true }: {
  actor: Actor;
  data: OfficeData;
  title: string;
  description: string;
  basePath: string;
  openId?: string | null;
  tab?: string;
  /** owner-only blocks shown between the metrics and the queue */
  between?: ReactNode;
  /** false: the page draws its own heading and KPI cards; only the queue (+ drawer) renders here */
  intro?: boolean;
}) {
  const m = workspaceMetrics(data.orders, data.payments);
  const filters = QUEUE_FILTERS.map((f) => ({ key: f.key, label: f.label, statuses: f.statuses, count: m.filterCounts[f.key] }));
  const openOk = !!openId && data.orders.some((o) => o.id === openId);
  return (
    <>
      {intro && <>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
        <LinkButton href="/staff/new" variant="default" size="xl" className="rounded-full"><Plus aria-hidden /> New Walk-In / Phone Order</LinkButton>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-5" data-testid="kpi-strip">
        <Metric testid="kpi-to-confirm" label="To confirm" value={m.toConfirm} sub="new orders to check" icon={<ClipboardList />} />
        <Metric testid="kpi-quote-payment" label="Quotation & payment" value={m.quotationAndPayment} sub="confirmed, before production" icon={<Receipt />} />
        <Metric testid="kpi-workshop" label="In workshop" value={m.inWorkshop} sub="building or inspection" icon={<Hammer />} />
        <Metric testid="kpi-delivery" label="Out / ready for delivery" value={m.delivery} sub="ready or on the road" icon={<Truck />} />
        <Metric testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} sub="verified furniture payments · active orders" icon={<Wallet />} />
      </div>
      </>}
      {between}
      <OrderQueue rows={queueRows(data.orders, data.payments, data.profiles)} filters={filters} basePath={basePath} openId={openOk ? openId : null} />
      {openOk && (
        <OrderDrawer closeHref={basePath}>
          <OrderWorkspace orderId={openId!} actor={actor} variant="drawer" initialTab={tab} />
        </OrderDrawer>
      )}
    </>
  );
}
