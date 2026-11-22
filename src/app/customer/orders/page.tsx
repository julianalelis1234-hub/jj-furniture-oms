import { ChevronRight, Sofa } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, EmptyState } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";
import { StageTracker, StatusBadge } from "@/components/status";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { STATUS_CUSTOMER_COPY } from "@/lib/domain/status";
import { getCustomer, getCustomerStore } from "@/lib/server/customer-auth";
import { customerDashboard } from "@/lib/services/customer-portal";
import { CustomerLogoutButton } from "../logout-button";

export const metadata = { title: "My orders" };

/** CU-01 dashboard: every order linked to this verified account (auth user = orders.customer_user_id). */
export default async function CustomerOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const customer = await getCustomer();
  if (!customer) redirect("/customer/login");
  const welcome = (await searchParams).welcome === "1";
  const orders = await customerDashboard(await getCustomerStore(), customer.id);
  return (
    <AppShell portal="customer" actor={null} headerExtra={<CustomerLogoutButton />} live={<LiveSync />}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Signed in as {customer.email}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">My orders</h1>
          {welcome && <p className="mt-2 rounded-lg bg-success-soft p-3 text-sm" data-testid="welcome">Your password is saved. Welcome, {customer.full_name}!</p>}
        </div>
        {orders.length === 0 ? <EmptyState title="No orders linked to this account yet" /> : (
          <ul className="grid gap-3" data-testid="customer-orders">
            {orders.map(({ id, view: v }) => (
              <li key={id}>
                <Link href={`/customer/orders/${encodeURIComponent(v.order_code)}`} className="grid gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/50">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sofa className="size-5 text-primary" aria-hidden />
                    <span className="font-mono font-bold">{v.order_code}</span>
                    <StatusBadge status={v.status} />
                    <ChevronRight className="ml-auto size-5 text-muted-foreground" aria-hidden />
                  </div>
                  <p className="font-semibold">{v.quantity} × {v.item_name}</p>
                  <p className="text-sm text-muted-foreground">{STATUS_CUSTOMER_COPY[v.status]}</p>
                  <StageTracker status={v.status} compact />
                  <p className="text-sm tabular-nums">
                    Est. completion {formatDate(v.estimated_completion_date)}
                    {v.payment.furniture_price != null && <> · To pay on delivery <b>{formatPeso(v.payment.collectible_on_delivery)}</b></>}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
