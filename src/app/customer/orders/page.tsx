import { CalendarClock, ChevronRight, ListOrdered, PencilRuler, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/app-shell";
import {
  CardSection, DarkCard, DarkFigure, DarkStats, DashboardHeader, darkPrimary, darkSecondary, dashCard, headerPrimary, KpiCard, KpiRow,
} from "@/components/dashboard";
import { PortalShell } from "@/components/portal-shell";
import { RowLink, RowList } from "@/components/rows";
import { StageTracker, StatusBadge } from "@/components/status";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { STATUS_CUSTOMER_COPY } from "@/lib/domain/status";
import { getCustomer, getCustomerStore } from "@/lib/server/customer-auth";
import { customerDashboard } from "@/lib/services/customer-portal";
import { cn } from "@/lib/utils";
import { CustomerLogoutButton } from "../logout-button";

export const metadata = { title: "My orders" };

const orderHref = (code: string) => `/customer/orders/${encodeURIComponent(code)}`;
const monthDay = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(`${iso}T00:00:00Z`));

/** CU-01 dashboard: every order linked to this verified account (auth user = orders.customer_user_id). */
export default async function CustomerOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const customer = await getCustomer();
  if (!customer) redirect("/customer/login");
  const welcome = (await searchParams).welcome === "1";
  const orders = await customerDashboard(await getCustomerStore(), customer.id);
  const now = new Date();
  const views = orders.map((o) => o.view);
  const active = views.filter((v) => v.status !== "Delivered");
  const toAccept = active.filter((v) => v.status === "Confirmed" && v.quotation_issued_at && !v.specs_confirmed);
  const checking = views.flatMap((v) => v.payments).filter((p) => p.state === "pending");
  const paid = views.reduce((s, v) => s + v.payment.furniture_paid + v.payment.delivery_fee_paid, 0);
  const onDelivery = active.reduce((s, v) => s + (v.payment.furniture_price != null ? v.payment.collectible_on_delivery : 0), 0);
  const nextDue = active.map((v) => v.estimated_completion_date).filter((d): d is string => !!d).sort()[0] ?? null;
  const latest = active[0] ?? views[0] ?? null;
  const waiting = toAccept.length;
  const tip = toAccept[0]
    ? `Your quotation for ${toAccept[0].order_code} is ready. Accept it and choose how to pay so the shop can start.`
    : checking.length ? "The shop is checking your payment. You'll see it as verified on the order page."
      : latest ? STATUS_CUSTOMER_COPY[latest.status] : "Design a piece in 3D and send it to the shop.";

  return (
    <PortalShell portal="customer" actor={null} name={customer.full_name}
      signOutControl={<CustomerLogoutButton compact />} headerExtra={<CustomerLogoutButton />}>
      <DashboardHeader name={customer.full_name} now={now}
        summary={`signed in as ${customer.email}`}
        actions={<Link href="/customer/customize" className={headerPrimary}><PencilRuler className="size-4" aria-hidden /> New custom order</Link>} />
      {welcome && <p className="mb-3 sm:mb-5 rounded-xl bg-success-soft p-3 text-sm" data-testid="welcome">Your password is saved. Welcome, {customer.full_name}!</p>}

      <KpiRow>
        <KpiCard label="Active orders" value={active.length} icon={<ListOrdered />} sub={`${views.length - active.length} delivered`} />
        <KpiCard label="Next completion" value={nextDue ? monthDay(nextDue) : "—"} icon={<CalendarClock />} sub={nextDue ? `${formatDate(nextDue)} · estimated by the shop` : "estimated by the shop"} />
        <KpiCard label="Paid so far" value={formatPeso(paid)} icon={<Wallet />} sub={checking.length ? `${checking.length} being checked by the shop` : "verified payments"} tone={checking.length ? "warning" : "good"} />
        <KpiCard label="To pay on delivery" value={formatPeso(onDelivery)} icon={<Truck />} sub="balance + delivery fee" />
      </KpiRow>

      <div className="mb-3 sm:mb-5 grid gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="latest-title" className={cn(dashCard, "min-w-0 p-3.5 sm:p-5")}>
          <h2 id="latest-title" className="mb-3 sm:mb-4 text-base font-bold sm:text-lg">Latest order</h2>
          {!latest ? <p className="text-sm text-muted-foreground">No orders linked to this account yet.</p> : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={orderHref(latest.order_code)} className="font-mono font-bold underline-offset-4 hover:underline">{latest.order_code}</Link>
                <StatusBadge status={latest.status} />
              </div>
              <p className="text-lg sm:text-xl font-bold">{latest.quantity} × {latest.item_name}</p>
              <div className="sm:hidden"><StageTracker status={latest.status} compact /></div>
              <div className="hidden sm:block"><StageTracker status={latest.status} /></div>
              <p className="text-sm text-muted-foreground">{STATUS_CUSTOMER_COPY[latest.status]}</p>
              <Link href={orderHref(latest.order_code)} className="inline-flex items-center gap-1 text-sm font-bold text-primary underline-offset-4 hover:underline">
                Open order <ChevronRight className="size-4" aria-hidden />
              </Link>
            </div>
          )}
        </section>

        <DarkCard id="next-title" title="What happens next" chip="">
          <DarkFigure value={waiting} caption={waiting === 1 ? "quotation waiting for you" : "quotations waiting for you"}
            note={waiting ? "Accept to let the shop start" : "Nothing waiting on you"} noteTone={waiting ? "warning" : "good"} />
          <DarkStats items={[
            { label: "Active", value: active.length },
            { label: "Being checked", value: checking.length },
            { label: "Delivered", value: views.length - active.length },
          ]} />
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">{tip}</p>
          <div className="mt-auto flex gap-2">
            {toAccept[0]
              ? <Link href={orderHref(toAccept[0].order_code)} className={darkPrimary}>Review quotation</Link>
              : latest ? <Link href={orderHref(latest.order_code)} className={darkPrimary}>Open latest order</Link>
                : <Link href="/customer/customize" className={darkPrimary}>Design a piece</Link>}
            <Link href="/customer/customize" className={darkSecondary}>New order</Link>
          </div>
        </DarkCard>
      </div>

      <CardSection id="my-orders" title="My orders">
        {orders.length === 0 ? <EmptyState title="No orders linked to this account yet" /> : (
          <RowList data-testid="customer-orders">
            {orders.map(({ id, view: v }) => (
              <RowLink key={id} href={orderHref(v.order_code)} className="flex-col items-stretch gap-3">
                <span className="flex flex-wrap items-start gap-x-6 gap-y-1.5">
                  <span className="grid min-w-0 flex-1 gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold">{v.order_code}</span>
                      <StatusBadge status={v.status} />
                    </span>
                    <span className="font-semibold">{v.quantity} × {v.item_name}</span>
                    <span className="text-sm text-muted-foreground">{STATUS_CUSTOMER_COPY[v.status]}</span>
                  </span>
                  <span className="basis-full text-xs tabular-nums text-muted-foreground sm:basis-auto sm:text-right sm:text-sm">
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
      </CardSection>
    </PortalShell>
  );
}
