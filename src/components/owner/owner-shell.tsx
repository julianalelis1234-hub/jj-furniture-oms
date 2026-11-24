import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell";
import type { Actor } from "@/lib/domain/types";

/** Every owner page: the shared portal shell with the owner's sections and live counts. */
export function OwnerShell({ actor, badges, children }: { actor: Actor; badges?: Partial<Record<string, number>>; children: ReactNode }) {
  return <PortalShell portal="owner" actor={actor} badges={badges}>{children}</PortalShell>;
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
