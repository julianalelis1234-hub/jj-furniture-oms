import Link from "next/link";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { todayISO } from "@/lib/domain/dates";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";
import { staffTasks } from "@/lib/services/insights";

export const metadata = { title: "Staff" };

/** The office team: who encodes and confirms orders, and the shared task inbox they work from. */
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
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Staff" description="The office team and the work waiting in their shared task inbox."
        actions={<Link href="/staff#task-inbox" className="text-sm font-bold underline underline-offset-4">Open the staff task inbox</Link>} />
      <section aria-labelledby="queue-title" className="mb-10">
        <h2 id="queue-title" className="mb-3 text-2xl">Waiting for the office</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4" data-testid="office-queues">
          {queues.map(([label, n]) => (
            <div key={label} className="border-t-2 border-foreground/80 pt-2">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-3xl font-extrabold tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="team-title">
        <h2 id="team-title" className="mb-3 text-2xl">Team</h2>
        <RowList data-testid="staff-list">
          {staff.map((p) => {
            const encoded = data.orders.filter((o) => o.encoded_by_id === p.id);
            const recent = encoded.filter((o) => Date.parse(o.created_at) >= since).length;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-3 sm:px-3">
                <b className="min-w-40">{p.full_name}</b>
                <span className="text-sm text-muted-foreground">{p.phone ?? "no phone on file"}</span>
                <span className="ml-auto flex gap-2 text-xs font-bold">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 tabular-nums">{recent} orders encoded · 30 days</span>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 tabular-nums">{encoded.length} in total</span>
                  {!p.is_active && <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-destructive">inactive</span>}
                </span>
              </li>
            );
          })}
        </RowList>
      </section>
    </OwnerShell>
  );
}
