import { CheckCircle2, CircleHelp, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { CardSection, chip, DarkCard, darkPrimary, KpiCard, KpiRow, PageHeading } from "@/components/dashboard";
import { PortalShell } from "@/components/portal-shell";
import { requireActor } from "@/lib/server/context";
import { cn } from "@/lib/utils";
import { loadWorkshop } from "../data";

export const metadata = { title: "My questions" };

/** Craftsman · My questions: the spec questions on my jobs and whether the office has answered. */
export default async function CraftsmanQuestions() {
  const actor = await requireActor(["craftsman"]);
  const { jobs, myQuestions, badges } = await loadWorkshop(actor);
  const job = new Map(jobs.map((j) => [j.id, j]));
  const open = myQuestions.filter((q) => q.status === "Pending");
  const answered = myQuestions.filter((q) => q.status !== "Pending");
  const list = (qs: typeof myQuestions) => (
    <ul className="grid gap-2 sm:gap-3">
      {qs.map((q) => {
        const j = job.get(q.order_id);
        return (
          <li key={q.id} className="rounded-xl border border-border bg-muted/40 p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <b className="tabular-nums">{j?.order_code ?? "Order"}</b>
              <span className="text-muted-foreground">{j ? `${j.quantity} × ${j.item_name}` : ""}</span>
              <span className={cn(chip, "ml-auto", q.status === "Pending" ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>{q.status === "Pending" ? "Waiting for the office" : q.status}</span>
            </p>
            <p className="mt-1.5 text-xs whitespace-pre-line sm:text-sm">{q.description}</p>
          </li>
        );
      })}
    </ul>
  );
  return (
    <PortalShell portal="craftsman" actor={actor} badges={badges}>
      <PageHeading title="My questions" description="Questions you asked about a job's size, wood or design. Ask a new one from the job card with the Ask button." />
      <KpiRow>
        <KpiCard label="Waiting" value={open.length} icon={<CircleHelp />} sub="for the office to answer" tone={open.length ? "warning" : "good"} />
        <KpiCard label="Answered" value={answered.length} icon={<CheckCircle2 />} sub="resolved by the office" tone="good" />
        <KpiCard label="All questions" value={myQuestions.length} icon={<MessageCircleQuestion />} sub="on your jobs" />
        <KpiCard label="My active jobs" value={badges["/craftsman/jobs"]} icon={<MessageCircleQuestion />} sub="assigned to you" />
      </KpiRow>
      <div className="grid gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <CardSection id="open" title="Waiting for an answer">{open.length ? list(open) : <p className="text-sm text-muted-foreground">No open questions.</p>}</CardSection>
          <CardSection id="answered" title="Answered">{answered.length ? list(answered) : <p className="text-sm text-muted-foreground">No answered questions yet.</p>}</CardSection>
        </div>
        <DarkCard id="ask-title" title="Need to ask something?" chip="">
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">Open the job under Workshop jobs and press Ask. The office sees your question at once; the job shows “For revision” until it is answered.</p>
          <div className="mt-auto flex gap-2"><Link href="/craftsman/jobs" className={darkPrimary}>Go to my jobs</Link></div>
        </DarkCard>
      </div>
    </PortalShell>
  );
}
