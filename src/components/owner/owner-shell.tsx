import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";
import type { Actor } from "@/lib/domain/types";
import { OwnerNav } from "./owner-nav";

/** Every owner page: the shared app shell (wide) with the section sidebar. */
export function OwnerShell({ actor, badges, children }: { actor: Actor; badges?: Partial<Record<string, number>>; children: ReactNode }) {
  return (
    <AppShell portal="owner" actor={actor} live={<LiveSync />} wide>
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
        <OwnerNav badges={badges} />
        <div className="min-w-0">{children}</div>
      </div>
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
