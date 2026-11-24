import { CheckCircle2, Clock, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CardSection, chip, KpiCard, KpiRow, PageHeading } from "@/components/dashboard";
import { PortalShell } from "@/components/portal-shell";
import { RowList } from "@/components/rows";
import { formatDateTime } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getCustomer, getCustomerStore } from "@/lib/server/customer-auth";
import { customerDashboard } from "@/lib/services/customer-portal";
import { cn } from "@/lib/utils";
import { CustomerLogoutButton } from "../logout-button";

export const metadata = { title: "Payments" };

const STATE = {
  verified: { label: "Verified", cls: "bg-success-soft text-success" },
  pending: { label: "Being checked", cls: "bg-warning-soft text-warning" },
  rejected: { label: "Not accepted", cls: "bg-destructive/10 text-destructive" },
} as const;

/** Customer · Payments: every payment on my orders and its state, plus what is left to pay. */
export default async function CustomerPayments() {
  const customer = await getCustomer();
  if (!customer) redirect("/customer/login");
  const orders = await customerDashboard(await getCustomerStore(), customer.id);
  const rows = orders.flatMap(({ view: v }) => v.payments.map((p) => ({ ...p, code: v.order_code, item: v.item_name })))
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  const verified = rows.filter((p) => p.state === "verified").reduce((s, p) => s + p.amount, 0);
  const checking = rows.filter((p) => p.state === "pending");
  const active = orders.map((o) => o.view).filter((v) => v.status !== "Delivered" && v.payment.furniture_price != null);
  const onDelivery = active.reduce((s, v) => s + v.payment.collectible_on_delivery, 0);
  const balance = active.reduce((s, v) => s + v.payment.remaining_furniture_balance, 0);
  return (
    <PortalShell portal="customer" actor={null} name={customer.full_name}
      signOutControl={<CustomerLogoutButton compact />} headerExtra={<CustomerLogoutButton />}>
      <PageHeading title="Payments" description="Every payment you sent and whether the shop has verified it. To pay, open the order and use Submit a payment." />
      <KpiRow>
        <KpiCard label="Verified" value={formatPeso(verified)} icon={<CheckCircle2 />} sub="counted by the shop" tone="good" />
        <KpiCard label="Being checked" value={checking.length} icon={<Clock />} sub={checking.length ? formatPeso(checking.reduce((s, p) => s + p.amount, 0)) : "nothing waiting"} tone={checking.length ? "warning" : "muted"} />
        <KpiCard label="Furniture balance" value={formatPeso(balance)} icon={<Wallet />} sub="still to pay on active orders" />
        <KpiCard label="To pay on delivery" value={formatPeso(onDelivery)} icon={<Truck />} sub="balance + delivery fee" />
      </KpiRow>
      <CardSection id="payments" title="Payment history">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet. Open an order with a quotation to choose how to pay.</p> : (
          <RowList data-testid="customer-payment-history">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/customer/orders/${encodeURIComponent(p.code)}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2.5 hover:bg-accent-soft/60 sm:px-2 sm:py-3">
                  <b className="font-mono text-sm sm:text-base">{p.code}</b>
                  <span className="min-w-0 flex-1 text-xs sm:text-sm">{p.payment_type} · {p.payment_method}{p.reference_number ? ` · ref. ${p.reference_number}` : ""} <span className="text-muted-foreground">· {formatDateTime(p.paid_at)}</span>
                    {p.state === "rejected" && p.rejection_reason && <span className="block text-destructive">{p.rejection_reason}</span>}
                  </span>
                  <b className="text-sm tabular-nums sm:text-base">{formatPeso(p.amount)}</b>
                  <span className={cn(chip, STATE[p.state].cls)}>{STATE[p.state].label}</span>
                </Link>
              </li>
            ))}
          </RowList>
        )}
      </CardSection>
    </PortalShell>
  );
}
