import { Check } from "lucide-react";
import { STATUS_SHORT, stageIndex } from "@/lib/domain/status";
import { ORDER_STATUSES, type OrderStatus, type PriorityLabel } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const TONE: Record<OrderStatus, string> = {
  "Waiting for Confirmation": "bg-warning-soft text-warning border-warning/40",
  Confirmed: "bg-info-soft text-info border-info/40",
  "In Production": "bg-accent text-accent-foreground border-primary/30",
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
      <span className="tabular-nums opacity-70">{stageIndex(status) + 1}/7</span> {STATUS_SHORT[status]}
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

/** The 7 standardized stages as a vertical (mobile) / horizontal (desktop) tracker. */
export function StageTracker({ status, compact = false }: { status: OrderStatus; compact?: boolean }) {
  const current = stageIndex(status);
  return (
    <ol className={cn("grid gap-2", compact ? "grid-cols-7" : "sm:grid-cols-7")} aria-label="Order progress">
      {ORDER_STATUSES.map((s, i) => {
        const done = i < current || status === "Delivered";
        const active = i === current && status !== "Delivered";
        return (
          <li key={s} className={cn("flex items-center gap-3 sm:flex-col sm:items-center sm:gap-1.5 sm:text-center", compact && "flex-col gap-1 text-center")}>
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                done && "border-success bg-success text-success-foreground",
                active && "border-primary bg-primary text-primary-foreground ring-4 ring-primary/20",
                !done && !active && "border-border bg-card text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <Check className="size-4" /> : i + 1}
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
