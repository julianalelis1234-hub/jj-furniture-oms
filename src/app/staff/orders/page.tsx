import { ClipboardList, Hammer, Plus, Receipt, Wallet } from "lucide-react";
import Link from "next/link";
import { CardSection, headerPrimary, KpiCard, KpiRow, PageHeading } from "@/components/dashboard";
import { OfficeWorkspace } from "@/components/office/office-workspace";
import { StaffShell } from "@/components/staff-shell";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData } from "@/lib/server/office-data";
import { workspaceMetrics } from "@/lib/services/insights";

export const metadata = { title: "Order queue" };

/** Staff · Order queue: every order with stage filters and search; an order opens in the drawer. */
export default async function StaffOrders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(["staff", "owner"]);
  const sp = await searchParams;
  const data = await loadOfficeData(await getStore());
  const m = workspaceMetrics(data.orders, data.payments);
  return (
    <StaffShell actor={actor} data={data}>
      <PageHeading title="Order queue" description="Every order, from the first check to the customer's door. Filter by stage or search."
        actions={<Link href="/staff/new" className={headerPrimary}><Plus className="size-4" aria-hidden /> New walk-in order</Link>} />
      <KpiRow>
        <KpiCard label="To confirm" value={m.toConfirm} icon={<ClipboardList />} sub="new orders to check" tone={m.toConfirm ? "warning" : "muted"} />
        <KpiCard label="Quotation & payment" value={m.quotationAndPayment} icon={<Receipt />} sub="confirmed, before production" />
        <KpiCard label="In the workshop" value={m.inWorkshop} icon={<Hammer />} sub={`${m.delivery} ready or out for delivery`} />
        <KpiCard label="Collected deposits" value={formatPeso(m.collectedDeposits)} icon={<Wallet />} sub="verified payments · active orders" tone="good" />
      </KpiRow>
      <CardSection id="queue" title="All orders" chip="Tap an order to open it">
        <OfficeWorkspace actor={actor} data={data} basePath="/staff/orders" openId={typeof sp.order === "string" ? sp.order : null}
          tab={typeof sp.tab === "string" ? sp.tab : undefined} intro={false} title="Order queue" description="" />
      </CardSection>
    </StaffShell>
  );
}
