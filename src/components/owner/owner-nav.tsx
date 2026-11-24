"use client";

import { BarChart3, ClipboardList, Hammer, Layers, LayoutDashboard, ShieldCheck, Truck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const OWNER_SECTIONS = [
  { href: "/owner", label: "Dashboard", icon: LayoutDashboard },
  { href: "/owner/orders", label: "Orders & Quotations", icon: ClipboardList },
  { href: "/owner/staff", label: "Staff", icon: Users },
  { href: "/owner/craftsmen", label: "Craftsmen", icon: Hammer },
  { href: "/owner/deliveries", label: "Deliveries", icon: Truck },
  { href: "/owner/inventory", label: "Lumber & Inventory", icon: Layers },
  { href: "/owner/reports", label: "Reports", icon: BarChart3 },
  { href: "/owner/access", label: "Roles & Access", icon: ShieldCheck },
] as const;

/**
 * The owner's section navigation: a sticky left sidebar on wide screens, a
 * scrollable row of pills on phones and tablets. `badges` carries live counts
 * (decisions waiting, low stock, ...).
 */
export function OwnerNav({ badges = {} }: { badges?: Partial<Record<string, number>> }) {
  const path = usePathname();
  const active = (href: string) => (href === "/owner" ? path === "/owner" : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Owner sections" data-testid="owner-nav"
      className="no-print -mx-4 mb-5 overflow-x-auto px-4 lg:sticky lg:top-24 lg:mx-0 lg:mb-0 lg:self-start lg:overflow-visible lg:px-0">
      <ul className="flex gap-2 lg:flex-col lg:gap-0.5">
        {OWNER_SECTIONS.map(({ href, label, icon: Icon }) => {
          const on = active(href);
          const n = badges[href];
          return (
            <li key={href} className="shrink-0">
              <Link href={href} aria-current={on ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none lg:rounded-xl lg:border-transparent lg:px-3",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent-soft/60 hover:text-foreground",
                )}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="lg:flex-1">{label}</span>
                {!!n && (
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", on ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground")}>{n}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
