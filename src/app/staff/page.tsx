import { Inbox } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";
import { OfficeWorkspace } from "@/components/office/office-workspace";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData } from "@/lib/server/office-data";
import { staffTasks } from "@/lib/services/insights";

export const metadata = { title: "Operations & Order Queue" };

/** S-01 — 3-zone workspace (metrics · queue · order drawer) + a collapsed task inbox. */
export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(["staff", "owner"]);
  const sp = await searchParams;
  const data = await loadOfficeData(await getStore());
  const t = staffTasks(data.orders, data.payments, data.deliveries, data.exceptions, data.notifications);
  const code = (id: string) => data.orders.find((o) => o.id === id)?.order_code ?? "";
  // one line per pending job; each opens that order's drawer on the right tab
  const inbox: { id: string; order: string; label: string; tab: string }[] = [
    ...t.quoteRequests.map((o) => ({ id: o.id, order: o.order_code, label: "Issue the quotation (Option 2 request)", tab: "quotation" })),
    ...t.specProposals.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Review the customer's proposed changes", tab: "overview" })),
    ...t.needsConfirmation.map((o) => ({ id: o.id, order: o.order_code, label: "Record the customer's acceptance", tab: "quotation" })),
    ...t.needsDownPayment.map(({ order, shortfall }) => ({ id: order.id, order: order.order_code, label: `Log the 30% down payment (${formatPeso(shortfall)} short)`, tab: "payments" })),
    ...t.readyForProduction.map((o) => ({ id: o.id, order: o.order_code, label: "Release to the workshop (30% verified)", tab: "payments" })),
    ...t.cashHandovers.map(({ payment, order }) => ({ id: order.id, order: order.order_code, label: `Verify cash handover (${formatPeso(payment.amount)})`, tab: "payments" })),
    ...t.specQuestions.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Answer a craftsman's question", tab: "overview" })),
    ...t.failedDeliveries.map(({ order }) => ({ id: order.id, order: order.order_code, label: "Reschedule a failed delivery", tab: "overview" })),
    ...t.toSchedule.filter((o) => !t.failedDeliveries.some((f) => f.order.id === o.id)).map((o) => ({ id: o.id, order: o.order_code, label: "Schedule driver & vehicle", tab: "overview" })),
    ...t.touchUps.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Touch-up / repair work order", tab: "overview" })),
    ...t.missingFields.map(({ order, missing }) => ({ id: order.id, order: order.order_code, label: `Complete missing fields: ${missing.join(", ")}`, tab: "overview" })),
    ...t.failedSms.map((n) => ({ id: n.order_id, order: code(n.order_id), label: "Retry a failed customer SMS", tab: "quotation" })),
  ];
  const openId = typeof sp.order === "string" ? sp.order : null;
  return (
    <AppShell portal={actor.role === "owner" ? "owner" : "staff"} actor={actor} live={<LiveSync />}>
      <OfficeWorkspace actor={actor} data={data} basePath="/staff" openId={openId} tab={typeof sp.tab === "string" ? sp.tab : undefined}
        title="Operations & Order Queue" description="One shared, live order record for the counter, the workshop, the drivers and the customers." />
      <details className="mt-6 rounded-2xl border bg-card p-4" data-testid="task-inbox">
        <summary className="flex cursor-pointer items-center gap-2 text-lg font-semibold">
          <Inbox className="size-5 text-primary" aria-hidden /> Task inbox
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">{inbox.length}</span>
        </summary>
        {inbox.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nothing waiting. 🎉</p> : (
          <ul className="mt-3 grid gap-1.5">
            {inbox.map((x, i) => (
              <li key={`${x.id}-${i}`}>
                <Link href={`/staff?order=${x.id}&tab=${x.tab}`} scroll={false} className="flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm hover:bg-accent-soft">
                  <b className="shrink-0 tabular-nums">{x.order}</b><span className="min-w-0">{x.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </details>
    </AppShell>
  );
}
