import type { ReactNode } from "react";

/** Client-safe: used by both server pages and client boards. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
