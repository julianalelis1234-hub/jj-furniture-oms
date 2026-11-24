import { CheckCircle2, CircleDashed, RotateCcw, Truck } from "lucide-react";
import type { DispatchStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/** Rider language for a delivery's state (icon + word, never colour alone). */
export const DELIVERY_PILL: Record<DispatchStatus, { label: string; className: string; icon: typeof Truck }> = {
  Scheduled: { label: "On process", className: "bg-secondary text-foreground", icon: CircleDashed },
  "Out for Delivery": { label: "In transit", className: "bg-info-soft text-info", icon: Truck },
  Delivered: { label: "Delivered", className: "bg-success-soft text-success", icon: CheckCircle2 },
  "Failed / Reschedule": { label: "Failed · reschedule", className: "bg-destructive/10 text-destructive", icon: RotateCcw },
};

export function DeliveryPill({ status, className }: { status: DispatchStatus; className?: string }) {
  const p = DELIVERY_PILL[status];
  const Icon = p.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", p.className, className)} data-testid="delivery-pill">
      <Icon className="size-3.5" aria-hidden /> {p.label}
    </span>
  );
}
