import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Flat list: full-width horizontal rows on the page surface, separated by 1px hairlines.
 * No boxed cards, no drop shadows. Use for order lists and detail rows in every portal.
 */
export function RowList({ className, children, ...rest }: ComponentProps<"ul">) {
  return (
    <ul className={cn("divide-y divide-border border-y border-border", className)} {...rest}>
      {children}
    </ul>
  );
}

const ROW = "group flex w-full min-w-0 items-center gap-3 px-1 py-4 text-left outline-none transition-colors hover:bg-accent-soft/60 focus-visible:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring/40 sm:px-3";

/** A whole row that opens something: clicking anywhere on it navigates to `href`. */
export function RowLink({ href, className, children, ...rest }: Omit<ComponentProps<typeof Link>, "className"> & { className?: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} scroll={false} className={cn(ROW, className)} {...rest}>{children}</Link>
    </li>
  );
}

/** A static detail row: label on the left, value on the right (wraps on phones). */
export function DetailRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border py-2.5 last:border-b-0", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
