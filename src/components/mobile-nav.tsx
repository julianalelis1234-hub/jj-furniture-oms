"use client";

import { ClipboardList, Hammer, House, Inbox, LayoutDashboard, ListOrdered, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import type { Role } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: ComponentType<{ className?: string }>; match?: (p: string) => boolean };
type NavConfig = { left: Item[]; action?: { href: string; label: string }; right: Item[] };

/** What each role reaches with one thumb. The centre action is the one thing that role starts most. */
const NAV: Record<Role | "customer", NavConfig> = {
  customer: {
    left: [{ href: "/", label: "Home", icon: House, match: (p) => p === "/" }],
    action: { href: "/customer/customize", label: "New custom order" },
    right: [{ href: "/customer/orders", label: "My orders", icon: ListOrdered, match: (p) => p.startsWith("/customer/orders") }],
  },
  staff: {
    left: [{ href: "/staff", label: "Queue", icon: ClipboardList, match: (p) => p === "/staff" || p.startsWith("/staff/orders") }],
    action: { href: "/staff/new", label: "New walk-in order" },
    right: [{ href: "/staff#task-inbox", label: "Tasks", icon: Inbox, match: () => false }],
  },
  owner: {
    left: [{ href: "/owner", label: "Overview", icon: LayoutDashboard, match: (p) => p.startsWith("/owner") }],
    action: { href: "/staff/new", label: "New walk-in order" },
    right: [{ href: "/staff", label: "Queue", icon: ClipboardList, match: (p) => p.startsWith("/staff") && p !== "/staff/new" }],
  },
  craftsman: { left: [{ href: "/craftsman", label: "Jobs", icon: Hammer, match: (p) => p.startsWith("/craftsman") }], right: [] },
  driver: { left: [{ href: "/driver", label: "Deliveries", icon: Truck, match: (p) => p.startsWith("/driver") }], right: [] },
};

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined}
      className={cn("flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[11px] font-semibold transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
      <Icon className="size-5" />
      {item.label}
    </Link>
  );
}

/**
 * Floating bottom navigation for phones (hidden from md up and in print): rounded bar,
 * raised circular centre action for the role's most common start ("+ New custom order").
 */
export function MobileNav({ portal }: { portal: Role | "customer" }) {
  const path = usePathname();
  const cfg = NAV[portal];
  const is = (i: Item) => (i.match ? i.match(path) : path === i.href);
  if (!cfg.action && cfg.left.length + cfg.right.length <= 1) return null; // a single destination needs no bar
  return (
    <nav aria-label="Quick navigation" className="no-print fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="mx-auto flex max-w-sm items-center justify-around rounded-full border border-border bg-card/95 px-2 py-1.5 shadow-[0_12px_32px_-10px_rgba(43,29,23,0.45)] backdrop-blur">
        {cfg.left.map((i) => <NavLink key={i.href} item={i} active={is(i)} />)}
        {cfg.action && (
          <Link href={cfg.action.href} aria-label={cfg.action.label} data-testid="mobile-nav-action"
            className="-mt-7 flex size-15 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-[0_10px_24px_-6px_rgba(196,138,90,0.7)] focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
            <Plus className="size-7" strokeWidth={2.2} />
          </Link>
        )}
        {cfg.right.map((i) => <NavLink key={i.href} item={i} active={is(i)} />)}
      </div>
    </nav>
  );
}
