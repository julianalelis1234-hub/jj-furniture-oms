import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell";
import type { Actor } from "@/lib/domain/types";

/** Every owner page: the shared portal shell with the owner's sections and live counts. */
export function OwnerShell({ actor, badges, children }: { actor: Actor; badges?: Partial<Record<string, number>>; children: ReactNode }) {
  return <PortalShell portal="owner" actor={actor} badges={badges}>{children}</PortalShell>;
}

/** Page heading used by the owner sections: the dashboard's header style (title, one line, actions on the right). */
export function OwnerHeading({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-3">
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="text-xl font-bold tracking-[-0.02em] sm:text-3xl">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
