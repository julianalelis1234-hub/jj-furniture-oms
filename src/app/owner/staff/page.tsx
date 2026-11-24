import { ClipboardList, Inbox, Receipt, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { CardSection, chip, DarkCard, DarkFigure, DarkStats, darkPrimary, dashCard, headerSecondary, KpiCard, KpiRow, PersonCard } from "@/components/dashboard";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { todayISO } from "@/lib/domain/dates";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";
import { staffTasks } from "@/lib/services/insights";
import { cn } from "@/lib/utils";

export const metadata = { title: "Staff" };

/** The office team: what waits in their shared task inbox, and who encodes the orders. */
export default async function OwnerStaff() {
  const actor = await requireActor(["owner"]);
  const { data, badges } = await loadOwnerContext(await getStore());
  const t = staffTasks(data.orders, data.payments, data.deliveries, data.exceptions, data.notifications);
  const since = Date.parse(`${todayISO()}T00:00:00Z`) - 29 * 86_400_000; // the last 30 days, today included
  const staff = data.profiles.filter((p) => p.role === "staff");
  const queues: [string, number][] = [
    ["Orders to confirm", t.toConfirm.length], ["Quotations to issue", t.toQuote.length], ["Payments to verify", t.paymentsToVerify.length],
    ["Driver cash to count", t.cashHandovers.length], ["Ready for the workshop", t.readyForProduction.length], ["Deliveries to schedule", t.toSchedule.length],
    ["Craftsman questions", t.specQuestions.length], ["Customer change proposals", t.specProposals.length],
  ];
  const waiting = queues.reduce((s, [, n]) => s + n, 0);
  const busiest = [...queues].sort((a, b) => b[1] - a[1])[0];
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Staff" description="The office team and the work waiting in their shared task inbox."
        actions={<Link href="/staff#task-inbox" className={headerSecondary}><Inbox className="size-4 text-primary" aria-hidden /> Open the staff task inbox</Link>} />

      <KpiRow>
        <KpiCard label="Orders to confirm" value={t.toConfirm.length} icon={<ClipboardList />} sub="new online and walk-in orders" tone={t.toConfirm.length ? "warning" : "muted"} />
        <KpiCard label="Quotations to issue" value={t.toQuote.length} icon={<Receipt />} sub="confirmed, not yet quoted" />
        <KpiCard label="Payments to verify" value={t.paymentsToVerify.length + t.cashHandovers.length} icon={<Wallet />} sub="online, bank and rider cash" tone={t.paymentsToVerify.length + t.cashHandovers.length ? "warning" : "good"} />
        <KpiCard label="Deliveries to schedule" value={t.toSchedule.length} icon={<Truck />} sub="ready, no rider yet" />
      </KpiRow>

      <div className="mb-3 grid gap-3 sm:mb-5 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="queue-title" className={cn(dashCard, "min-w-0 p-3.5 sm:p-5")}>
          <h2 id="queue-title" className="mb-3 text-base font-bold sm:mb-4 sm:text-lg">Waiting for the office</h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" data-testid="office-queues">
            {queues.map(([label, n]) => (
              <div key={label} className="rounded-xl bg-muted/50 p-2.5 sm:p-3">
                <dt className="text-[11px] leading-tight text-muted-foreground sm:text-xs">{label}</dt>
                <dd className="mt-1 text-xl font-extrabold tabular-nums sm:text-2xl">{n}</dd>
              </div>
            ))}
          </dl>
        </section>
        <DarkCard id="office-title" title="The office today">
          <DarkFigure value={waiting} caption={waiting === 1 ? "task waiting" : "tasks waiting"}
            note={busiest && busiest[1] ? `Most waiting: ${busiest[0].toLowerCase()} (${busiest[1]})` : "Nothing waiting"} noteTone={waiting ? "warning" : "good"} />
          <DarkStats items={[
            { label: "Staff", value: staff.filter((p) => p.is_active).length },
            { label: "Questions", value: t.specQuestions.length },
            { label: "Proposals", value: t.specProposals.length },
          ]} />
          <div className="mt-auto flex gap-2"><Link href="/staff#task-inbox" className={darkPrimary}>Open the task inbox</Link></div>
        </DarkCard>
      </div>

      <CardSection id="team" title="Team" chip="Orders encoded per person">
        <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3" data-testid="staff-list">
          {staff.map((p) => {
            const encoded = data.orders.filter((o) => o.encoded_by_id === p.id);
            const recent = encoded.filter((o) => Date.parse(o.created_at) >= since).length;
            return (
              <PersonCard key={p.id} name={p.full_name} line={p.phone ?? "no phone on file"}
                chips={<>
                  <span className={chip}>{recent} · 30 days</span>
                  <span className={chip}>{encoded.length} total</span>
                  {!p.is_active && <span className={cn(chip, "bg-destructive/10 text-destructive")}>inactive</span>}
                </>} />
            );
          })}
        </ul>
      </CardSection>
    </OwnerShell>
  );
}
