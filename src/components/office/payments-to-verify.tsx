import { Banknote, Clock, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { CardSection, KpiCard, KpiRow, PageHeading } from "@/components/dashboard";
import { RowList } from "@/components/rows";
import { formatDateTime } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import type { OfficeData } from "@/lib/server/office-data";
import { staffInbox } from "@/lib/server/staff-inbox";

/**
 * Payments to verify (staff and owner): customer transfers and rider cash waiting to be
 * checked, and orders still short of the 30%. Each row opens the order's Payments tab.
 */
export function PaymentsToVerify({ data, ordersPath }: { data: OfficeData; ordersPath: string }) {
  const { t } = staffInbox(data);
  const open = (id: string) => `${ordersPath}?order=${id}&tab=payments`;
  const pendingTotal = [...t.paymentsToVerify, ...t.cashHandovers].reduce((s, x) => s + x.payment.amount, 0);
  return (
    <>
      <PageHeading title="Payments to verify" description="Only verified payments count toward the 30% and the balance. Check the reference number and receipt, then verify or reject." />
      <KpiRow>
        <KpiCard label="Online & bank" value={t.paymentsToVerify.length} icon={<ShieldCheck />} sub="reference + receipt to check" tone={t.paymentsToVerify.length ? "warning" : "good"} />
        <KpiCard label="Rider cash" value={t.cashHandovers.length} icon={<Banknote />} sub="handovers to count" tone={t.cashHandovers.length ? "warning" : "good"} />
        <KpiCard label="Waiting to verify" value={formatPeso(pendingTotal)} icon={<Wallet />} sub="not yet counted" />
        <KpiCard label="Short of 30%" value={t.needsDownPayment.length} icon={<Clock />} sub="orders waiting for a down payment" />
      </KpiRow>
      <CardSection id="to-verify" title="Customer payments" chip="Open the order to verify or reject">
        {t.paymentsToVerify.length === 0 ? <p className="text-sm text-muted-foreground">No online or bank payments waiting.</p> : (
          <RowList data-testid="payments-to-verify">
            {t.paymentsToVerify.map(({ payment: p, order: o }) => (
              <li key={p.id}>
                <Link href={open(o.id)} scroll={false} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2.5 hover:bg-accent-soft/60 sm:px-2 sm:py-3">
                  <b className="text-sm tabular-nums sm:text-base">{o.order_code}</b>
                  <span className="min-w-0 flex-1 text-xs sm:text-sm">{o.customer_name} · {p.payment_method} · ref. {p.reference_number ?? "—"} <span className="text-muted-foreground">· {formatDateTime(p.paid_at)}</span></span>
                  <b className="text-sm tabular-nums sm:text-base">{formatPeso(p.amount)}</b>
                </Link>
              </li>
            ))}
          </RowList>
        )}
      </CardSection>
      <div className="grid gap-3 sm:gap-5 xl:grid-cols-2">
        <CardSection id="cash" title="Rider cash handovers" className="mb-0 sm:mb-0">
          {t.cashHandovers.length === 0 ? <p className="text-sm text-muted-foreground">No cash waiting to be counted.</p> : (
            <RowList>
              {t.cashHandovers.map(({ payment: p, order: o }) => (
                <li key={p.id}>
                  <Link href={open(o.id)} scroll={false} className="flex items-center gap-3 px-1 py-2.5 text-xs hover:bg-accent-soft/60 sm:px-2 sm:text-sm">
                    <b className="tabular-nums">{o.order_code}</b><span className="min-w-0 flex-1">{o.customer_name}</span><b className="tabular-nums">{formatPeso(p.amount)}</b>
                  </Link>
                </li>
              ))}
            </RowList>
          )}
        </CardSection>
        <CardSection id="short" title="Waiting for the 30% down payment" className="mb-0 sm:mb-0">
          {t.needsDownPayment.length === 0 ? <p className="text-sm text-muted-foreground">Every accepted order has its 30%.</p> : (
            <RowList>
              {t.needsDownPayment.map(({ order: o, shortfall }) => (
                <li key={o.id}>
                  <Link href={open(o.id)} scroll={false} className="flex items-center gap-3 px-1 py-2.5 text-xs hover:bg-accent-soft/60 sm:px-2 sm:text-sm">
                    <b className="tabular-nums">{o.order_code}</b><span className="min-w-0 flex-1">{o.customer_name}</span><span className="font-semibold text-warning tabular-nums">{formatPeso(shortfall)} short</span>
                  </Link>
                </li>
              ))}
            </RowList>
          )}
        </CardSection>
      </div>
    </>
  );
}
