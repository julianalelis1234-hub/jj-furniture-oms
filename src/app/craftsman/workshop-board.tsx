"use client";

import { CircleHelp, Hourglass, PackageCheck, Ruler } from "lucide-react";
import { useState } from "react";
import { requestExceptionAction, transitionAction } from "@/app/actions";
import { ActionDialog } from "@/components/action-dialog";
import { EmptyState } from "@/components/empty-state";
import { Field, TextArea } from "@/components/form";
import { PriorityBadge } from "@/components/status";
import { formatDate, todayISO, daysBetween } from "@/lib/domain/dates";
import type { WorkshopOrder } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { FurniturePreview } from "@/components/orders/FurniturePreview";
import { formatDims } from "@/lib/domain/furniture";

type Tab = "todo" | "progress" | "revision" | "done";
type Question = { id: string; order_id: string; description: string; status: string; requested_by: string | null };

const TABS: { id: Tab; label: string }[] = [
  { id: "todo", label: "Up Next" },
  { id: "progress", label: "In Progress" },
  { id: "revision", label: "For Revision" },
  { id: "done", label: "Done" },
];

function tabOf(j: WorkshopOrder, questions: Question[]): Tab {
  if (j.status === "Confirmed") return "todo";
  if (j.status === "In Production") {
    const openQ = questions.some((q) => q.order_id === j.id && q.status === "Pending");
    return j.needs_revision || openQ ? "revision" : "progress";
  }
  return "done";
}

export function WorkshopBoard({ jobs, names, me, questions }: { jobs: WorkshopOrder[]; names: Record<string, string>; me: string; questions: Question[] }) {
  const [tab, setTab] = useState<Tab>("todo");
  const counts = Object.fromEntries(TABS.map((t) => [t.id, jobs.filter((j) => tabOf(j, questions) === t.id).length])) as Record<Tab, number>;
  const shown = jobs.filter((j) => tabOf(j, questions) === tab);
  const today = todayISO();

  return (
    <div>
      <div role="tablist" aria-label="Job status" className="sticky top-[60px] z-20 -mx-4 mb-4 grid grid-cols-4 gap-1 bg-background/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn("flex h-14 flex-col items-center justify-center rounded-xl border text-sm font-semibold leading-tight",
              tab === t.id ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
            {t.label}
            <span className="text-lg font-black tabular-nums">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={tab === "revision" ? "No jobs sent back. Good work!" : "No jobs here"}>
          {tab === "todo" ? "Confirmed jobs appear here. The office releases them to production once the 30% down payment is verified." : undefined}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((j) => {
            const due = j.estimated_completion_date ? daysBetween(today, j.estimated_completion_date) : 99;
            const myQs = questions.filter((q) => q.order_id === j.id);
            return (
              <li key={j.id} className={cn("rounded-2xl border-2 bg-card p-4", j.priority_label === "Urgent" && "border-destructive", j.needs_revision && "border-warning")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-black">{j.order_code}</span>
                  <PriorityBadge label={j.priority_label} rank={j.priority_rank} />
                </div>
                <p className="mt-1 text-lg font-semibold">{j.quantity} × {j.item_name}</p>
                {j.approved_revision_number && (
                  <p className="text-xs font-semibold text-success tabular-nums">Build from confirmed spec revision {j.approved_revision_number}</p>
                )}
                <FurniturePreview
                  compact
                  className="mt-2"
                  legacyDimensions={j.is_legacy_incomplete ? j.dimensions : null}
                  spec={{ furniture_category: j.furniture_category, design_variant: j.design_variant, width_cm: j.width_cm, height_cm: j.height_cm, depth_cm: j.depth_cm, wood_type: j.wood_type, color_finish: j.color_finish }}
                />
                <dl className="mt-2 grid gap-1 text-base">
                  <div className="flex gap-2"><Ruler className="mt-1 size-4 shrink-0" aria-hidden /><dd className="font-bold tabular-nums">{formatDims(j) ? `W ${j.width_cm} × H ${j.height_cm} × D ${j.depth_cm} cm` : <span className="text-warning">Dimensions Pending Clarification — {j.dimensions}</span>}</dd></div>
                  {j.design_variant && <div><dt className="inline text-muted-foreground">Design: </dt><dd className="inline font-semibold">{j.design_variant}</dd></div>}
                  <div><dt className="inline text-muted-foreground">Wood: </dt><dd className="inline font-semibold">{j.wood_type}{j.custom_wood_note ? ` (${j.custom_wood_note})` : ""}</dd></div>
                  <div><dt className="inline text-muted-foreground">Finish: </dt><dd className="inline font-semibold">{j.color_finish}</dd></div>
                  {j.special_instructions && <p className="mt-1 rounded-lg bg-accent-soft p-2 text-sm whitespace-pre-line text-foreground">{j.special_instructions}</p>}
                  {j.reference_photo_url && <a href={j.reference_photo_url} target="_blank" rel="noreferrer noopener" className="text-sm text-primary underline">Open reference photo</a>}
                </dl>
                <p className={cn("mt-2 text-sm", due < 0 ? "font-bold text-destructive" : due <= 2 ? "font-semibold text-warning" : "text-muted-foreground")}>
                  {due < 0 ? `${-due} day(s) late · ` : due === 0 ? "Due today · " : ""}Target {formatDate(j.estimated_completion_date)}
                  {j.assigned_craftsman_id && <> · {j.assigned_craftsman_id === me ? "Assigned to you" : names[j.assigned_craftsman_id]}</>}
                </p>
                {myQs.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-sm">
                    {myQs.map((q) => (
                      <li key={q.id} className={cn("rounded-lg border p-2", q.status === "Pending" ? "border-warning bg-warning-soft" : "bg-muted")}>
                        <b>{q.status === "Pending" ? "Waiting for answer:" : "Answered:"}</b> {q.description}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {j.status === "Confirmed" && (
                    <p className="flex items-start gap-2 rounded-lg border border-dashed p-2 text-sm text-muted-foreground" data-testid="awaiting-release">
                      <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
                      Up next — do not cut wood yet. The office releases this job after the 30% down payment is verified.
                    </p>
                  )}
                  {j.status === "In Production" && (
                    <ActionDialog trigger="Mark Ready for Owner Inspection" icon={<PackageCheck aria-hidden />} size="xl" variant="success"
                      title={`Ready for inspection: ${j.order_code}`} submitLabel="Send to owner" submitVariant="success"
                      action={(fd) => transitionAction(j.id, "Completed / For Inspection", j.version, String(fd.get("notes") || "Ready for owner inspection"))}>
                      <ul className="grid gap-1 text-sm">
                        {["Dimensions measured and match", "Finish is even, no drips", "Joints are tight", "Hardware installed"].map((c) => (
                          <li key={c}><label className="flex items-center gap-2"><input type="checkbox" required className="size-5" /> {c}</label></li>
                        ))}
                      </ul>
                      <Field label="Note for the owner (optional)" htmlFor={`n-${j.id}`}>
                        <TextArea id={`n-${j.id}`} name="notes" />
                      </Field>
                    </ActionDialog>
                  )}
                  {j.status !== "Completed / For Inspection" && j.status !== "Ready for Delivery" && (
                    <ActionDialog trigger="Ask Spec Question" icon={<CircleHelp aria-hidden />} size="xl" variant="outline"
                      title={`Question about ${j.order_code}`} description="The office will check with the customer and answer here."
                      submitLabel="Send question"
                      action={(fd) => requestExceptionAction({ order_id: j.id, category: "Spec Clarification", description: String(fd.get("q") ?? "") })}>
                      {(errors) => (
                        <Field label="Your question" htmlFor={`q-${j.id}`} required error={errors.description}>
                          <TextArea id={`q-${j.id}`} name="q" required placeholder="e.g. Is the 90cm width with or without the overhang?" />
                        </Field>
                      )}
                    </ActionDialog>
                  )}
                  {(j.status === "Completed / For Inspection" || j.status === "Ready for Delivery") && (
                    <p className="text-sm font-semibold text-success">{j.status === "Ready for Delivery" ? "Passed inspection ✓" : "Waiting for owner inspection"}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
