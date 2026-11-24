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
 * The owner's section navigation.
 *  - `sidebar`: the vertical list inside the full-height left sidebar (wide screens)
 *  - `pills`: a scrollable row of pills above the page (phones and tablets)
 * `badges` carries live counts (decisions waiting, low stock, ...).
 */
export function OwnerNav({ badges = {}, variant = "pills" }: { badges?: Partial<Record<string, number>>; variant?: "sidebar" | "pills" }) {
  const path = usePathname();
  const active = (href: string) => (href === "/owner" ? path === "/owner" : path === href || path.startsWith(`${href}/`));
  const sidebar = variant === "sidebar";
  return (
    <nav aria-label="Owner sections" data-testid={sidebar ? "owner-nav" : "owner-nav-pills"}
      className={sidebar ? "px-3" : "no-print -mx-4 mb-5 overflow-x-auto px-4 lg:hidden"}>
      <ul className={sidebar ? "grid gap-0.5" : "flex gap-2"}>
        {OWNER_SECTIONS.map(({ href, label, icon: Icon }) => {
          const on = active(href);
          const n = badges[href];
          return (
            <li key={href} className="shrink-0">
              <Link href={href} aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                  sidebar
                    ? cn("min-h-10 rounded-xl px-3", on ? "bg-accent-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")
                    : cn("min-h-11 rounded-full border px-4", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent-soft/60 hover:text-foreground"),
                )}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className={sidebar ? "flex-1" : undefined}>{label}</span>
                {!!n && (
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                    sidebar ? (on ? "bg-primary text-primary-foreground" : "bg-muted text-foreground") : (on ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"))}>{n}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
