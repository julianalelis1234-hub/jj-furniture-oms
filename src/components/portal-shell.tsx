import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { AppShell, Logo } from "@/components/app-shell";
import { LiveSync, type LiveOptions } from "@/components/live-sync";
import { PortalNav, type Portal } from "@/components/portal-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { isDemoMode } from "@/lib/config";
import type { Actor } from "@/lib/domain/types";

const ROLE_LABEL: Record<Portal, string> = {
  owner: "Owner", staff: "Store assistant", craftsman: "Craftsman", driver: "Delivery rider", customer: "Customer",
};

export const initials = (name: string) =>
  name.replace(/^(mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** The signed-in person at the bottom of the sidebar, with sign out. */
function SidebarFooter({ portal, name, signOutControl, live }: { portal: Portal; name: string; signOutControl?: ReactNode; live?: LiveOptions | false }) {
  return (
    <div className="mt-auto grid min-w-0 gap-2 p-3">
      <div className="grid justify-items-start gap-2 px-1">
        {/* the single LiveSync for the page: it stays mounted (and subscribed) on phones too, where the sidebar is hidden */}
        {live !== false && <LiveSync {...(live ?? {})} />}
        <ThemeToggle />
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-muted/70 p-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-hidden>{initials(name)}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-bold">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{ROLE_LABEL[portal]} · JJ Enterprises</span>
        </span>
        {signOutControl ?? (
          <form action={signOut}>
            <Button variant="ghost" size="icon-touch" type="submit" aria-label={isDemoMode() ? "Exit" : "Sign out"} title={isDemoMode() ? "Exit" : "Sign out"}>
              <LogOut aria-hidden />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Every signed-in portal page. Wide screens: a full-height sidebar (logo, the role's
 * sections, the signed-in person) beside the page. Phones and tablets: the shared top
 * bar, section pills above the page and the floating bottom navigation.
 */
export function PortalShell({ portal, actor, name, badges, live, signOutControl, headerExtra, children }: {
  portal: Portal;
  /** staff-side portals; customers pass `name` instead */
  actor: Actor | null;
  name?: string;
  badges?: Partial<Record<string, number>>;
  live?: LiveOptions | false;
  /** replaces the default sign-out form (customers use their own log-out action) */
  signOutControl?: ReactNode;
  /** extra controls in the phone top bar (e.g. the customer log-out button) */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const who = name ?? actor?.full_name ?? "";
  return (
    <AppShell
      portal={portal}
      actor={actor}
      headerExtra={headerExtra ? <span className="lg:hidden">{headerExtra}</span> : undefined}
      sidebar={
        <>
          <div className="px-5 pt-5 pb-6"><Logo /></div>
          <PortalNav portal={portal} badges={badges} variant="sidebar" />
          <SidebarFooter portal={portal} name={who} signOutControl={signOutControl} live={live} />
        </>
      }
    >
      <PortalNav portal={portal} badges={badges} variant="pills" />
      {children}
    </AppShell>
  );
}
