import { CircleHelp, Hammer, Hourglass, PackageCheck } from "lucide-react";
import { CardSection, KpiCard, KpiRow, PageHeading } from "@/components/dashboard";
import { PortalShell } from "@/components/portal-shell";
import { requireActor } from "@/lib/server/context";
import { loadWorkshop } from "../data";
import { WorkshopBoard } from "../workshop-board";

export const metadata = { title: "Workshop jobs" };

/** Craftsman · Workshop jobs: the full board (Up next, In progress, For revision, Done). No prices, no customer contacts. */
export default async function CraftsmanJobs() {
  const actor = await requireActor(["craftsman"]);
  const { jobs, names, questions, badges } = await loadWorkshop(actor);
  const pending = (id: string) => questions.some((q) => q.order_id === id && q.status === "Pending");
  const building = jobs.filter((j) => j.status === "In Production");
  const revision = building.filter((j) => j.needs_revision || pending(j.id));
  return (
    <PortalShell portal="craftsman" actor={actor} badges={badges}>
      <PageHeading title="Workshop jobs" description="Sorted by the owner's priority. Tap a button when you start or finish." />
      <KpiRow>
        <KpiCard label="Up next" value={jobs.filter((j) => j.status === "Confirmed").length} icon={<Hourglass />} sub="released, waiting to start" />
        <KpiCard label="Building" value={building.length - revision.length} icon={<Hammer />} sub="in production now" tone="good" />
        <KpiCard label="For revision" value={revision.length} icon={<CircleHelp />} sub="a question or a fix is open" tone={revision.length ? "warning" : "muted"} />
        <KpiCard label="Done" value={jobs.filter((j) => j.status !== "Confirmed" && j.status !== "In Production").length} icon={<PackageCheck />} sub="finished" />
      </KpiRow>
      <CardSection id="jobs" title="All jobs" chip="Sorted by the owner's priority">
        <WorkshopBoard jobs={jobs} names={names} me={actor.id} questions={questions} />
      </CardSection>
    </PortalShell>
  );
}
