"use client";

import {
  BarChart3, ClipboardList, Hammer, House, Inbox, Layers, LayoutDashboard, ListOrdered, MessageCircleQuestion,
  PencilRuler, Plus, ShieldCheck, Truck, Users, Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import type { Role } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export type Portal = Role | "customer";
type Section = { href: string; label: string; icon: ComponentType<{ className?: string }>; exact?: boolean };

/** The sections each role sees in its sidebar (wide screens) and section pills (phones). */
export const PORTAL_SECTIONS: Record<Portal, Section[]> = {
  owner: [
    { href: "/owner", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/owner/orders", label: "Orders & Quotations", icon: ClipboardList },
    { href: "/owner/payments", label: "Payments to verify", icon: Wallet },
    { href: "/owner/staff", label: "Staff", icon: Users },
    { href: "/owner/craftsmen", label: "Craftsmen", icon: Hammer },
    { href: "/owner/deliveries", label: "Deliveries", icon: Truck },
    { href: "/owner/inventory", label: "Lumber & Inventory", icon: Layers },
    { href: "/owner/reports", label: "Reports", icon: BarChart3 },
    { href: "/owner/access", label: "Roles & Access", icon: ShieldCheck },
  ],
  staff: [
    { href: "/staff", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/staff/orders", label: "Order queue", icon: ClipboardList },
    { href: "/staff/tasks", label: "Task inbox", icon: Inbox },
    { href: "/staff/payments", label: "Payments to verify", icon: Wallet },
    { href: "/staff/deliveries", label: "Deliveries", icon: Truck },
    { href: "/staff/new", label: "New walk-in order", icon: Plus },
  ],
  craftsman: [
    { href: "/craftsman", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/craftsman/jobs", label: "Workshop jobs", icon: Hammer },
    { href: "/craftsman/questions", label: "My questions", icon: MessageCircleQuestion },
  ],
  driver: [
    { href: "/driver", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/driver#stops", label: "My deliveries", icon: Truck },
  ],
  customer: [
    { href: "/customer/orders", label: "My orders", icon: ListOrdered },
    { href: "/customer/payments", label: "Payments", icon: Wallet },
    { href: "/customer/customize", label: "New custom order", icon: PencilRuler },
    { href: "/", label: "JJ Enterprises home", icon: House, exact: true },
  ],
};

/**
 * Section navigation for every portal.
 *  - `sidebar`: the vertical list inside the full-height left sidebar (wide screens)
 *  - `pills`: a scrollable row of pills above the page (phones and tablets)
 * `badges` carries live counts keyed by section href.
 */
export function PortalNav({ portal, badges = {}, variant = "pills" }: { portal: Portal; badges?: Partial<Record<string, number>>; variant?: "sidebar" | "pills" }) {
  const path = usePathname();
  const sections = PORTAL_SECTIONS[portal];
  // a #section link is never "the current page"; the page itself is
  const active = (s: Section) => !s.href.includes("#") && (s.exact ? path === s.href : path === s.href || path.startsWith(`${s.href}/`));
  const sidebar = variant === "sidebar";
  const label = portal === "owner" ? "Owner sections" : "Sections";
  return (
    <nav aria-label={label} data-testid={sidebar ? `${portal}-nav` : `${portal}-nav-pills`}
      className={sidebar ? "px-3" : "no-print -mx-3 mb-3 overflow-x-auto px-3 sm:-mx-4 sm:mb-5 sm:px-4 lg:hidden"}>
      <ul className={sidebar ? "grid gap-0.5" : "flex gap-2"}>
        {sections.map((s) => {
          const on = active(s);
          const n = badges[s.href];
          const Icon = s.icon;
          return (
            <li key={s.href} className="shrink-0">
              <Link href={s.href} aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                  sidebar
                    ? cn("min-h-10 rounded-xl px-3", on ? "bg-accent-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")
                    : cn("min-h-10 rounded-full border px-3.5 text-[13px] sm:min-h-11 sm:px-4 sm:text-sm", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent-soft/60 hover:text-foreground"),
                )}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className={sidebar ? "flex-1" : undefined}>{s.label}</span>
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
