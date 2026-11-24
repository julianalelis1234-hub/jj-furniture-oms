import { CalendarClock, CircleHelp, Hammer, Hourglass, PackageCheck } from "lucide-react";
import Link from "next/link";
import { DesignNote } from "@/components/design-note";
import {
  CardSection, DarkCard, DarkFigure, DarkStats, DashboardHeader, darkPrimary, dashCard, KpiCard, KpiRow,
} from "@/components/dashboard";
import { DueBars } from "@/components/owner/dashboard-charts";
import { PortalShell } from "@/components/portal-shell";
import { PriorityBadge } from "@/components/status";
import { addDays, formatDate, todayISO } from "@/lib/domain/dates";
import { formatDims } from "@/lib/domain/furniture";
import type { WorkshopOrder } from "@/lib/domain/types";
import { requireActor } from "@/lib/server/context";
import { loadWorkshop } from "./data";
import { cn } from "@/lib/utils";
import { WorkshopBoard } from "./workshop-board";

export const metadata = { title: "Workshop" };

const weekday = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(Date.parse(`${iso}T00:00:00Z`));

/** C-01 — dashboard: greeting, job counts, the next job beside the week card, then the job board. No money, no customer contacts. */
export default async function CraftsmanPage() {
  const actor = await requireActor(["craftsman"]);
  const { jobs, names, questions: openQuestions, badges } = await loadWorkshop(actor);

  const now = new Date();
  const today = todayISO(now);
  const pendingQ = (j: WorkshopOrder) => openQuestions.some((q) => q.order_id === j.id && q.status === "Pending");
  const upNext = jobs.filter((j) => j.status === "Confirmed");
  const building = jobs.filter((j) => j.status === "In Production");
  const revision = building.filter((j) => j.needs_revision || pendingQ(j));
  const done = jobs.filter((j) => j.status !== "Confirmed" && j.status !== "In Production");
  const mine = jobs.filter((j) => j.assigned_craftsman_id === actor.id && (j.status === "Confirmed" || j.status === "In Production"));
  const next = mine[0] ?? upNext.find((j) => !j.assigned_craftsman_id) ?? null;
  const active = jobs.filter((j) => j.status === "Confirmed" || j.status === "In Production");
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const due = week.map((day, i) => ({ day, label: i === 0 ? "Today" : weekday(day), count: active.filter((j) => j.estimated_completion_date === day).length }));
  const dueThisWeek = due.reduce((s, d) => s + d.count, 0);
  const overdue = active.filter((j) => j.estimated_completion_date && j.estimated_completion_date < today).length;
  const myQuestions = openQuestions.filter((q) => q.status === "Pending" && jobs.some((j) => j.id === q.order_id && j.assigned_craftsman_id === actor.id)).length;
  const tip = overdue
    ? `${overdue} ${overdue === 1 ? "job is" : "jobs are"} past the completion date. Finish those first or ask the office for help.`
    : next ? `Next for you: ${next.quantity} × ${next.item_name} (${next.order_code}).` : "No jobs waiting. The office will release the next one.";

  return (
    <PortalShell portal="craftsman" actor={actor} badges={badges}>
      <DashboardHeader name={actor.full_name} now={now}
        summary={mine.length ? `${mine.length} ${mine.length === 1 ? "job" : "jobs"} assigned to you` : "no jobs assigned to you yet"} />

      <KpiRow>
        <KpiCard label="Up next" value={upNext.length} icon={<Hourglass />} sub="released, waiting to start" />
        <KpiCard label="Building" value={building.length - revision.length} icon={<Hammer />} sub="in production now" tone="good" />
        <KpiCard label="For revision" value={revision.length} icon={<CircleHelp />} sub="a question or a fix is open" tone={revision.length ? "warning" : "muted"} />
        <KpiCard label="Done" value={done.length} icon={<PackageCheck />} sub="finished, with the owner or delivery" />
      </KpiRow>

      <div className="mb-3 sm:mb-5 grid gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section id="next-up" aria-labelledby="next-up-title" className={cn(dashCard, "min-w-0 scroll-mt-6 p-3.5 sm:p-5")}>
          <h2 id="next-up-title" className="mb-3 sm:mb-4 text-base font-bold sm:text-lg">Next up for you</h2>
          {!next ? <p className="text-sm text-muted-foreground">Nothing assigned to you right now.</p> : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-lg sm:text-xl">{next.quantity} × {next.item_name}</b>
                <PriorityBadge label={next.priority_label} rank={next.priority_rank} />
              </div>
              <dl className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
                {[
                  ["Order", next.order_code],
                  ["Size (W × H × D)", formatDims(next) ?? next.dimensions],
                  ["Wood & finish", `${next.wood_type === "Other" && next.custom_wood_note ? next.custom_wood_note : next.wood_type} · ${next.color_finish}`],
                  ["Due", formatDate(next.estimated_completion_date)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/50 p-2.5 sm:rounded-xl sm:p-3">
                    <dt className="text-xs font-semibold text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 text-sm font-bold sm:text-base">{v}</dd>
                  </div>
                ))}
              </dl>
              {next.special_instructions && <p className="rounded-xl border border-dashed border-border p-3 text-sm"><b>Note:</b> {next.special_instructions}</p>}
              <p className="text-sm text-muted-foreground">{next.status === "Confirmed" ? "Released by the office. Press Start on the job below when you begin." : "In production. Press Ready when it is finished."}</p>
            </div>
          )}
        </section>

        <DarkCard id="craft-week-title" title="This week in the workshop">
          <DarkFigure value={dueThisWeek} caption={`${dueThisWeek === 1 ? "job" : "jobs"} due in the next 7 days`}
            note={overdue ? `${overdue} past the completion date` : "Nothing overdue"} noteTone={overdue ? "warning" : "good"} />
          <DueBars days={due} />
          <DarkStats items={[
            { label: "Mine", value: mine.length },
            { label: "Urgent", value: active.filter((j) => j.priority_label === "Urgent").length },
            { label: "My questions", value: myQuestions },
          ]} />
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">{tip}</p>
          <div className="mt-auto flex gap-2">
            <Link href="/craftsman/jobs" className={darkPrimary}><CalendarClock className="size-4" aria-hidden /> Go to my jobs</Link>
          </div>
        </DarkCard>
      </div>

      <CardSection id="jobs" title="Workshop jobs" chip="Sorted by the owner's priority">
        <DesignNote className="mb-3 sm:mb-4">
          Large cards and three verbs only (Start, Ready, Ask). Prices and customer contact details are never sent to this screen; the database view itself has no money columns.
        </DesignNote>
        <WorkshopBoard jobs={jobs} names={names} me={actor.id} questions={openQuestions} />
      </CardSection>
    </PortalShell>
  );
}
