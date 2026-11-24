import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell, EmptyState } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";
import { RowLink, RowList } from "@/components/rows";
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
          <RowList data-testid="customer-orders">
            {orders.map(({ id, view: v }) => (
              <RowLink key={id} href={`/customer/orders/${encodeURIComponent(v.order_code)}`} className="flex-col items-stretch gap-3">
                <span className="flex flex-wrap items-start gap-x-6 gap-y-1.5">
                  <span className="grid min-w-0 flex-1 gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold">{v.order_code}</span>
                      <StatusBadge status={v.status} />
                    </span>
                    <span className="font-semibold">{v.quantity} × {v.item_name}</span>
                    <span className="text-sm text-muted-foreground">{STATUS_CUSTOMER_COPY[v.status]}</span>
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground sm:text-right">
                    Est. completion {formatDate(v.estimated_completion_date)}
                    {v.payment.furniture_price != null && <span className="block">To pay on delivery <b className="text-foreground">{formatPeso(v.payment.collectible_on_delivery)}</b></span>}
                  </span>
                  <ChevronRight className="hidden size-5 shrink-0 self-center text-muted-foreground sm:block" aria-hidden />
                </span>
                <StageTracker status={v.status} compact />
              </RowLink>
            ))}
          </RowList>
        )}
      </div>
    </AppShell>
  );
}
