import { LogOut } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { isDemoMode } from "@/lib/config";
import { demoSwitcherAllowed } from "@/lib/server/context";
import type { Actor, Role } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { DemoBar } from "./demo-bar";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

const PORTAL_LABEL: Record<Role | "customer", { title: string; code: string }> = {
  owner: { title: "Owner Dashboard", code: "O-01" },
  staff: { title: "Store Assistant", code: "S-01" },
  craftsman: { title: "Workshop", code: "C-01" },
  driver: { title: "Deliveries", code: "D-01" },
  customer: { title: "Customer Portal", code: "CU-01" },
};

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="JJ Enterprises — Furniture and Lumber Dealer — home">
      {/* the carved emblem, background removed (public/brand/jj-enterprises-logo.png) */}
      <Image src="/brand/jj-enterprises-logo-128.png" alt="" width={40} height={42} priority className="size-10 object-contain" />
      <span className="leading-none">
        <span className="block text-[1.15rem] font-extrabold tracking-[-0.02em]">JJ Enterprises</span>
        <span className="block pt-0.5 text-[0.72rem] font-semibold text-muted-foreground">Furniture and Lumber Dealer</span>
      </span>
    </Link>
  );
}

export async function AppShell({
  portal,
  actor,
  headerExtra,
  live,
  wide = false,
  sidebar,
  children,
}: {
  portal: Role | "customer";
  /** wider page (owner dashboard with its sidebar) */
  wide?: boolean;
  actor: Actor | null;
  headerExtra?: ReactNode;
  /** live-sync indicator + subscription for this page: pass <LiveSync /> (server component) */
  live?: ReactNode;
  /** full-height left sidebar on wide screens (owner portal); the top bar then shows on phones and tablets only */
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  const demo = isDemoMode();
  const switcher = await demoSwitcherAllowed(); // role-switcher bar: the all-roles Demo account only
  const p = PORTAL_LABEL[portal];
  const header = (
      <header className={cn("dark no-print sticky top-0 z-30 border-b border-border bg-background/95 text-foreground backdrop-blur", sidebar && "lg:hidden")}>
        <div className={cn("mx-auto flex items-center gap-2 px-3 py-1.5 sm:gap-3 sm:px-4 sm:py-2.5 max-sm:[&_img]:size-8 max-sm:[&_button]:min-h-10 max-sm:[&_button]:min-w-10", wide ? "max-w-[90rem]" : "max-w-6xl")}>
          <Logo />
          <div className="ml-1 hidden border-l pl-3 sm:block">
            <p className="text-sm font-semibold">{p.title}</p>
            {actor && <p className="text-xs text-muted-foreground">{actor.full_name}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {live}
            {headerExtra}
            <ThemeToggle />
            {actor && (
              <form action={signOut}>
                <Button variant="ghost" size="touch" type="submit" aria-label="Sign out">
                  <LogOut aria-hidden />
                  <span className="hidden md:inline">{demo ? "Exit" : "Sign out"}</span>
                </Button>
              </form>
            )}
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-3 pb-1.5 sm:hidden">
          <p className="text-xs font-semibold">
            {p.title} {actor && <span className="font-normal text-muted-foreground">· {actor.full_name}</span>}
          </p>
        </div>
      </header>
  );
  if (sidebar) {
    return (
      <div className="min-h-dvh bg-muted/40">
        {switcher && <DemoBar current={portal} />}
        <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-border bg-card lg:flex" aria-label="Sidebar">{sidebar}</aside>
          <div className="flex min-h-dvh min-w-0 flex-col">
            {header}
            <main className="mx-auto w-full max-w-[84rem] flex-1 px-3 pt-3 pb-28 sm:px-4 sm:pt-6 md:pb-6 lg:px-8 lg:pt-8">{children}</main>
            <MobileNav portal={portal} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col">
      {switcher && <DemoBar current={portal} />}
      {/* Espresso navigation anchor in both modes: the `dark` class scopes the dark tokens to the header */}
      {header}
      {/* bottom padding on phones keeps content clear of the floating nav */}
      <main className={cn("mx-auto w-full flex-1 px-4 pt-4 pb-28 sm:pt-6 md:pb-6", wide ? "max-w-[90rem]" : "max-w-6xl")}>{children}</main>
      <footer className="no-print border-t py-4 pb-28 text-center text-xs text-muted-foreground md:pb-4">
        JJ Enterprises — Furniture and Lumber Dealer · Poblacion, Valencia City, Bukidnon
      </footer>
      <MobileNav portal={portal} />
    </div>
  );
}

export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {/* basis keeps the title on its own line on phones; actions wrap below */}
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Section({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">{count}</span>
        )}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

export { EmptyState } from "./empty-state";
