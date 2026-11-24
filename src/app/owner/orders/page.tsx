import { ClipboardList, Hammer, Plus, Receipt, Wallet } from "lucide-react";
import Link from "next/link";
import { CardSection, headerPrimary, KpiCard, KpiRow } from "@/components/dashboard";
import { OfficeWorkspace } from "@/components/office/office-workspace";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";
import { workspaceMetrics } from "@/lib/services/insights";

export const metadata = { title: "Orders & Quotations" };

/** Every order and quotation: four headline cards, then the shared queue + order drawer in a card. */
export default async function OwnerOrders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(["owner"]);
  const sp = await searchParams;
  const { data, badges } = await loadOwnerContext(await getStore());
  const m = workspaceMetrics(data.orders, data.payments);
  const openId = typeof sp.order === "string" ? sp.order : null;
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Orders & Quotations" description="Confirm new orders, issue quotations, verify payments and follow every order to the door."
        actions={<Link href="/staff/new" className={headerPrimary}><Plus className="size-4" aria-hidden /> New order</Link>} />
      <KpiRow testid="kpi-strip">
        <KpiCard testid="kpi-to-confirm" label="To confirm" value={m.toConfirm} icon={<ClipboardList />} sub="new orders to check" tone={m.toConfirm ? "warning" : "muted"} />
        <KpiCard testid="kpi-quote-payment" label="Quotation & payment" value={m.quotationAndPayment} icon={<Receipt />} sub="confirmed, before production" />
        <KpiCard testid="kpi-workshop" label="In the workshop" value={m.inWorkshop} icon={<Hammer />} sub={`${m.delivery} ready or out for delivery`} />
        <KpiCard testid="kpi-deposits" label="Collected deposits" value={formatPeso(m.collectedDeposits)} icon={<Wallet />} sub="verified payments · active orders" tone="good" />
      </KpiRow>
      <CardSection id="queue" title="Order queue" chip="Tap an order to open it">
        <OfficeWorkspace actor={actor} data={data} basePath="/owner/orders" openId={openId} tab={typeof sp.tab === "string" ? sp.tab : undefined} intro={false}
          title="Orders & Quotations" description="" />
      </CardSection>
    </OwnerShell>
  );
}
