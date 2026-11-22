import { Check } from "lucide-react";
import { STATUS_SHORT, stageIndex } from "@/lib/domain/status";
import { WORKSHOP_STAGES, type OrderStatus, type PriorityLabel } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const TONE: Record<OrderStatus, string> = {
  "Quote Requested": "bg-secondary text-foreground border-dashed border-primary/50",
  "Waiting for Confirmation": "bg-warning-soft text-warning border-warning/40",
  Confirmed: "bg-info-soft text-info border-info/40",
  "In Production": "bg-accent-soft text-foreground border-live/70",
  "Completed / For Inspection": "bg-info-soft text-info border-info/40",
  "Ready for Delivery": "bg-success-soft text-success border-success/40",
  "Out for Delivery": "bg-info-soft text-info border-info/40",
  Delivered: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE[status],
        className,
      )}
    >
      {status === "Quote Requested" ? (
        <span className="font-normal">Intake ·</span>
      ) : (
        <span className="font-normal tabular-nums">{stageIndex(status)}/7</span>
      )}{" "}
      {STATUS_SHORT[status]}
    </span>
  );
}

const PRIORITY_TONE: Record<PriorityLabel, string> = {
  Urgent: "bg-destructive text-destructive-foreground border-destructive",
  High: "bg-warning-soft text-warning border-warning/50",
  Normal: "bg-muted text-muted-foreground border-border",
};

export function PriorityBadge({ label, rank }: { label: PriorityLabel; rank?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold", PRIORITY_TONE[label])}>
      {rank && rank < 99 ? `#${rank} · ` : ""}
      {label}
    </span>
  );
}

/**
 * The 7 standardized workshop & delivery stages as a vertical (mobile) /
 * horizontal (desktop) tracker. "Quote Requested" is pre-production intake:
 * no stage is active yet.
 */
export function StageTracker({ status, compact = false }: { status: OrderStatus; compact?: boolean }) {
  const current = stageIndex(status) - 1; // 0-based position in WORKSHOP_STAGES; -1 for Quote Requested
  const last = WORKSHOP_STAGES.length - 1;
  return (
    <ol className={cn("grid gap-2", compact ? "grid-cols-7" : "sm:grid-cols-7")} aria-label="Order progress">
      {WORKSHOP_STAGES.map((s, i) => {
        const done = i < current || status === "Delivered";
        const active = i === current && status !== "Delivered";
        const trackDone = i < current || status === "Delivered";
        return (
          <li key={s} className={cn("relative flex items-center gap-3 sm:flex-col sm:items-center sm:gap-1.5 sm:text-center", compact && "flex-col gap-1 text-center")}>
            {/* track to the next stage: Mocha when passed, Latte while pending */}
            {i < last && (
              <span
                aria-hidden
                className={cn(
                  "absolute rounded-full",
                  compact ? "top-[15px] left-[calc(50%+18px)] h-0.5 w-[calc(100%-36px+0.5rem)]" : "top-8 left-[15px] h-[calc(100%-24px)] w-0.5 sm:top-[15px] sm:left-[calc(50%+18px)] sm:h-0.5 sm:w-[calc(100%-36px+0.5rem)]",
                  trackDone ? "bg-stage-done" : "bg-stage-track",
                )}
              />
            )}
            <span className="relative flex size-8 shrink-0 items-center justify-center" aria-hidden>
              <span
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums",
                  done && "border-stage-done bg-stage-done text-stage-done-foreground",
                  active && "jj-pulse-ring border-live bg-live text-[#2b1d17]",
                  !done && !active && "border-stage-track bg-background text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
            </span>
            <span
              className={cn(
                "text-sm leading-tight",
                compact && "hidden text-[0.7rem] sm:block",
                active ? "font-bold text-foreground" : done ? "text-foreground" : "text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
