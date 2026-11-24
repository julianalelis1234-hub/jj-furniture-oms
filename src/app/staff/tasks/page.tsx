import { ClipboardList, Hammer, MessageCircleQuestion, Receipt, Truck, Wallet, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CardSection, KpiCard, KpiRow, PageHeading } from "@/components/dashboard";
import { StaffShell } from "@/components/staff-shell";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData } from "@/lib/server/office-data";
import { staffInbox, type InboxItem } from "@/lib/server/staff-inbox";

export const metadata = { title: "Task inbox" };

const GROUPS: { kind: InboxItem["kind"]; title: string; icon: ReactNode }[] = [
  { kind: "confirm", title: "Orders to confirm", icon: <ClipboardList /> },
  { kind: "quote", title: "Quotations to issue", icon: <Receipt /> },
  { kind: "payment", title: "Payments", icon: <Wallet /> },
  { kind: "workshop", title: "Release to the workshop", icon: <Hammer /> },
  { kind: "delivery", title: "Deliveries", icon: <Truck /> },
  { kind: "question", title: "Questions and change requests", icon: <MessageCircleQuestion /> },
  { kind: "fix", title: "Fixes and follow-ups", icon: <Wrench /> },
];

/** Staff · Task inbox: every pending office job, grouped; each opens the order on the right tab. */
export default async function StaffTasks() {
  const actor = await requireActor(["staff", "owner"]);
  const data = await loadOfficeData(await getStore());
  const { t, items } = staffInbox(data);
  return (
    <StaffShell actor={actor} data={data}>
      <PageHeading title="Task inbox" description="Everything waiting for the office, grouped by job. Tap a line to open that order." />
      <KpiRow>
        <KpiCard label="All tasks" value={items.length} icon={<ClipboardList />} sub="waiting for the office" tone={items.length ? "warning" : "good"} />
        <KpiCard label="To confirm" value={t.toConfirm.length} icon={<ClipboardList />} sub="new orders" />
        <KpiCard label="Payments" value={t.paymentsToVerify.length + t.cashHandovers.length} icon={<Wallet />} sub="to verify" />
        <KpiCard label="Questions" value={t.specQuestions.length + t.specProposals.length} icon={<MessageCircleQuestion />} sub="craftsmen and customers" />
      </KpiRow>
      {items.length === 0 && <CardSection id="empty" title="Nothing waiting"><p className="text-sm text-muted-foreground">The inbox is clear. 🎉</p></CardSection>}
      <div className="grid gap-3 sm:gap-5 xl:grid-cols-2" data-testid="task-groups">
        {GROUPS.map((g) => {
          const rows = items.filter((x) => x.kind === g.kind);
          if (rows.length === 0) return null;
          return (
            <CardSection key={g.kind} id={`tasks-${g.kind}`} className="mb-0 sm:mb-0"
              title={<span className="flex items-center gap-2"><span className="text-primary [&_svg]:size-4" aria-hidden>{g.icon}</span>{g.title}
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">{rows.length}</span></span>}>
              <ul className="divide-y divide-border border-y border-border">
                {rows.map((x, i) => (
                  <li key={`${x.id}-${i}`}>
                    <Link href={`/staff/orders?order=${x.id}&tab=${x.tab}`} scroll={false} className="flex min-h-11 items-center gap-3 px-1 py-2 text-xs hover:bg-accent-soft/60 sm:px-2 sm:text-sm">
                      <b className="shrink-0 tabular-nums">{x.order}</b><span className="min-w-0">{x.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardSection>
          );
        })}
      </div>
    </StaffShell>
  );
}
