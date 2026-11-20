"use client";

import { Lightbulb } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDesignNotes } from "./providers";

/** HCI rationale callouts, visible only when "Design Notes" is on in Demo Mode. */
export function DesignNote({ children, className }: { children: ReactNode; className?: string }) {
  const { enabled } = useDesignNotes();
  if (!enabled) return null;
  return (
    <aside
      className={cn(
        "flex gap-2 rounded-lg border border-dashed border-info bg-info-soft p-3 text-sm text-foreground",
        className,
      )}
      aria-label="Design note"
    >
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <div>
        <span className="font-semibold text-info">Design note · </span>
        {children}
      </div>
    </aside>
  );
}
