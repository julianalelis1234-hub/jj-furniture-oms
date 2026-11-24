import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { AppShell, Logo } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { isDemoMode } from "@/lib/config";
import type { Actor } from "@/lib/domain/types";
import { OwnerNav } from "./owner-nav";

const initials = (name: string) =>
  name.replace(/^(mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/**
 * Bottom of the sidebar: who is signed in, live status, theme and sign out.
 * The single LiveSync instance lives here; it stays mounted (and subscribed) on
 * phones too, where the sidebar is hidden.
 */
function SidebarFooter({ actor }: { actor: Actor }) {
  return (
    <div className="mt-auto grid min-w-0 gap-2 p-3">
      <div className="grid justify-items-start gap-2 px-1">
        <LiveSync />
        <ThemeToggle />
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-muted/70 p-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-hidden>
          {initials(actor.full_name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-bold">{actor.full_name}</span>
          <span className="block truncate text-xs text-muted-foreground">Owner · JJ Enterprises</span>
        </span>
        <form action={signOut}>
          <Button variant="ghost" size="icon-touch" type="submit" aria-label={isDemoMode() ? "Exit" : "Sign out"} title={isDemoMode() ? "Exit" : "Sign out"}>
            <LogOut aria-hidden />
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Every owner page. Wide screens: a full-height sidebar (logo, sections, signed-in
 * owner) beside the page. Phones and tablets: the shared top bar, section pills
 * above the page and the floating bottom navigation.
 */
export function OwnerShell({ actor, badges, children }: { actor: Actor; badges?: Partial<Record<string, number>>; children: ReactNode }) {
  return (
    <AppShell
      portal="owner"
      actor={actor}
      sidebar={
        <>
          <div className="px-5 pt-5 pb-6"><Logo /></div>
          <OwnerNav badges={badges} variant="sidebar" />
          <SidebarFooter actor={actor} />
        </>
      }
    >
      <OwnerNav badges={badges} variant="pills" />
      {children}
    </AppShell>
  );
}

/** Page heading used by the owner sections. */
export function OwnerHeading({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
