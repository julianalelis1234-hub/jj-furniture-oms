import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell";
import type { LiveOptions } from "@/components/live-sync";
import type { Actor } from "@/lib/domain/types";
import type { OfficeData } from "@/lib/server/office-data";
import { staffBadges } from "@/lib/server/staff-inbox";

/** Staff pages (also opened by the owner): the right sidebar for the signed-in role, with live counts for staff. */
export function StaffShell({ actor, data, live, children }: { actor: Actor; data?: OfficeData; live?: LiveOptions | false; children: ReactNode }) {
  const owner = actor.role === "owner";
  return (
    <PortalShell portal={owner ? "owner" : "staff"} actor={actor} badges={!owner && data ? staffBadges(data) : undefined} live={live}>
      {children}
    </PortalShell>
  );
}
