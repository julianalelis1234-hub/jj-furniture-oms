import "server-only";
import type { Actor, WorkshopOrder } from "@/lib/domain/types";
import { getStore } from "@/lib/server/context";

export type CraftQuestion = { id: string; order_id: string; description: string; status: string; requested_by: string | null };

/** The craftsman portal's data: only the money-free workshop projection, names, and spec questions. */
export async function loadWorkshop(actor: Actor) {
  const store = await getStore();
  const [jobs, profiles, exceptions] = await Promise.all([store.listWorkshopOrders(), store.listProfiles(), store.listExceptions()]);
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.full_name]));
  const questions: CraftQuestion[] = exceptions
    .filter((q) => q.category === "Spec Clarification")
    .map((q) => ({ id: q.id, order_id: q.order_id, description: q.description, status: q.status, requested_by: q.requested_by }));
  jobs.sort((a, b) => a.priority_rank - b.priority_rank || (a.estimated_completion_date ?? "").localeCompare(b.estimated_completion_date ?? ""));
  const mineIds = new Set(jobs.filter((j) => j.assigned_craftsman_id === actor.id).map((j) => j.id));
  const myQuestions = questions.filter((q) => mineIds.has(q.order_id) || q.requested_by === actor.full_name);
  const badges = {
    "/craftsman/jobs": jobs.filter((j: WorkshopOrder) => j.assigned_craftsman_id === actor.id && (j.status === "Confirmed" || j.status === "In Production")).length,
    "/craftsman/questions": myQuestions.filter((q) => q.status === "Pending").length,
  };
  return { jobs, names, questions, myQuestions, badges };
}
