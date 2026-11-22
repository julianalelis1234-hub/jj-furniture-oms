import { LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { isDemoMode } from "@/lib/config";
import type { Actor, Role } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { DemoBar } from "./demo-bar";
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
    <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">JJ</span>
      <span className="leading-tight">
        JJ Furniture
        <span className="block text-[0.7rem] font-medium text-muted-foreground">Valencia City, Bukidnon</span>
      </span>
    </Link>
  );
}

export function AppShell({
  portal,
  actor,
  headerExtra,
  live,
  children,
}: {
  portal: Role | "customer";
  actor: Actor | null;
  headerExtra?: ReactNode;
  /** live-sync indicator + subscription for this page: pass <LiveSync /> (server component) */
  live?: ReactNode;
  children: ReactNode;
}) {
  const demo = isDemoMode();
  const p = PORTAL_LABEL[portal];
  return (
    <div className="flex min-h-dvh flex-col">
      {demo && <DemoBar current={portal} />}
      <header className="no-print sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
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
        <div className="mx-auto max-w-6xl px-4 pb-2 sm:hidden">
          <p className="text-sm font-semibold">
            {p.title} {actor && <span className="font-normal text-muted-foreground">· {actor.full_name}</span>}
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">{children}</main>
      <footer className="no-print border-t py-4 text-center text-xs text-muted-foreground">
        JJ Furniture Shop and Enterprises · Poblacion, Valencia City, Bukidnon
      </footer>
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

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
