import { AppShell, PageTitle } from "@/components/app-shell";
import { DesignNote } from "@/components/design-note";
import { getStore, requireActor } from "@/lib/server/context";
import { WorkshopBoard } from "./workshop-board";

export const metadata = { title: "Workshop" };

export default async function CraftsmanPage() {
  const actor = await requireActor(["craftsman"]);
  const store = await getStore();
  // Only the money-free workshop projection is fetched for this portal.
  const [jobs, profiles, questions] = await Promise.all([
    store.listWorkshopOrders(),
    store.listProfiles(),
    store.listExceptions(),
  ]);
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.full_name]));
  const openQuestions = questions
    .filter((q) => q.category === "Spec Clarification")
    .map((q) => ({ id: q.id, order_id: q.order_id, description: q.description, status: q.status, requested_by: q.requested_by }));
  jobs.sort((a, b) => a.priority_rank - b.priority_rank || a.estimated_completion_date.localeCompare(b.estimated_completion_date));

  return (
    <AppShell portal="craftsman" actor={actor}>
      <PageTitle title="Workshop jobs" description="Sorted by the owner's priority. Tap a button when you start or finish." />
      <DesignNote className="mb-4">
        Large cards and three verbs only (Start, Ready, Ask). Prices and customer contact details are never sent to this screen; the database view itself has no money columns.
      </DesignNote>
      <WorkshopBoard jobs={jobs} names={names} me={actor.id} questions={openQuestions} />
    </AppShell>
  );
}
