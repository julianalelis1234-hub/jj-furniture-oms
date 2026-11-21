import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StageTracker } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { STATUS_CUSTOMER_COPY } from "@/lib/domain/status";
import { getPublicStore } from "@/lib/server/context";
import { getVerifiedCustomerOrderId } from "@/lib/server/customer-session";
import { customerOrderView } from "@/lib/services/customer";
import { CustomerSignOut } from "./customer-actions";
import { SpecReview } from "./spec-review";

export const metadata = { title: "My order" };

export default async function CustomerOrderPage() {
  const orderId = await getVerifiedCustomerOrderId();
  if (!orderId) redirect("/track");
  const v = await customerOrderView(await getPublicStore(), orderId);
  const p = v.payment;

  return (
    <AppShell portal="customer" actor={null} headerExtra={<CustomerSignOut />}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Order {v.order_code} · for {v.customer_name}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{v.quantity} × {v.item_name}</h1>
          <p className="mt-1">{STATUS_CUSTOMER_COPY[v.status]}</p>
        </div>

        <Card><CardContent className="pt-4"><StageTracker status={v.status} /></CardContent></Card>

        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl border bg-card p-3"><p className="text-xs uppercase text-muted-foreground">Estimated completion</p><p className="font-bold">{formatDate(v.estimated_completion_date)}</p></div>
          <div className="rounded-xl border bg-card p-3"><p className="text-xs uppercase text-muted-foreground">Scheduled delivery</p><p className="font-bold">{formatDate(v.scheduled_delivery_date)}</p></div>
        </div>

        <SpecReview key={`${v.current?.revision_number}-${v.spec_state}`} view={v} />

        <Card>
          <CardHeader><CardTitle>Payment summary</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between"><dt>Furniture price</dt><dd className="font-semibold tabular-nums">{formatPeso(p.furniture_price)}</dd></div>
              <div className="flex justify-between"><dt>30% down payment</dt><dd className="tabular-nums">{formatPeso(p.standard_down_payment_due)}</dd></div>
              <div className="flex justify-between"><dt>Paid so far (verified)</dt><dd className="tabular-nums text-success">− {formatPeso(p.furniture_paid)}</dd></div>
              <div className="flex justify-between"><dt>Remaining furniture balance</dt><dd className="tabular-nums">{formatPeso(p.remaining_furniture_balance)}</dd></div>
              <div className="flex justify-between"><dt>Delivery fee</dt><dd className="tabular-nums">{p.delivery_fee === 0 ? "FREE (Valencia City)" : formatPeso(p.delivery_fee)}</dd></div>
              <div className="mt-1 flex justify-between border-t pt-1.5 text-base"><dt className="font-bold">To pay on delivery</dt><dd className="font-black tabular-nums">{formatPeso(p.collectible_on_delivery)}</dd></div>
            </dl>
            {p.terms !== "Standard 30/70" && <p className="mt-2 text-xs text-muted-foreground">Payment terms: {p.terms}</p>}
            {p.furniture_paid < p.standard_down_payment_due && v.status !== "Delivered" && p.terms === "Standard 30/70" && (
              <p className="mt-2 rounded-lg bg-warning-soft p-2 text-sm">Please settle the 30% down payment ({formatPeso(p.standard_down_payment_due - p.furniture_paid)} remaining) at the shop or by GCash so we can start building.</p>
            )}
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">Deliver to: {v.delivery_address}, {v.municipality}</p>

        {v.open_repairs.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Your requests</CardTitle></CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {v.open_repairs.map((r, i) => (
                  <li key={i} className="rounded-lg border p-2"><b>{r.status}</b> · <span className="whitespace-pre-line">{r.description}</span><span className="block text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span></li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
          <CardContent>
            <ol className="grid gap-1.5 border-l-2 pl-4 text-sm">
              {v.timeline.map((t, i) => (<li key={i}><b>{t.to_status}</b> <span className="text-muted-foreground">· {formatDateTime(t.changed_at)}</span></li>))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
