import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Uppercase, wide-tracked micro-label pill with a 1px Caramel border.
 * Text stays Mocha (light, 7.3:1) / Latte (dark) — Caramel is decoration only.
 */
export function Eyebrow({ children, icon, className }: { children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-live bg-background/60 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase sm:text-xs",
        className,
      )}
    >
      <span className="text-live" aria-hidden>{icon ?? <Sparkles className="size-3.5" />}</span>
      {children}
    </span>
  );
}

/** Line icon inside a soft rounded-square badge (Mocha icon on a Caramel wash). */
export function IconBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl border border-live/40 bg-accent-soft text-primary [&_svg]:size-5", className)} aria-hidden>
      {children}
    </span>
  );
}
