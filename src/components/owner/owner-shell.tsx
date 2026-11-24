import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell";
import type { Actor } from "@/lib/domain/types";

/** Every owner page: the shared portal shell with the owner's sections and live counts. */
export function OwnerShell({ actor, badges, children }: { actor: Actor; badges?: Partial<Record<string, number>>; children: ReactNode }) {
  return <PortalShell portal="owner" actor={actor} badges={badges}>{children}</PortalShell>;
}

/** Page heading used by the owner sections (the shared section heading). */
export { PageHeading as OwnerHeading } from "@/components/dashboard";
