"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useRealtimeOrders, type LiveBatch } from "@/hooks/useRealtimeOrders";
import type { LiveStatus } from "@/lib/realtime/core";
import type { LiveViewerRole } from "@/lib/realtime/events";
import { cn } from "@/lib/utils";

export const LIVE_DOM_EVENT = "jj:live-sync";
export type LiveDomEventDetail = { orderIds: string[]; reconcile: boolean };

const LABEL: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  live: "Live Sync Active",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

/**
 * Something the person is in the middle of: an open dialog or a focused field.
 * Live updates wait until it is closed / left, so modals, unsaved inputs and
 * the 3D turntable camera are never disturbed.
 */
function busy() {
  // an open action dialog pauses live updates; the order drawer itself does not (it refreshes in place)
  if (document.querySelector('[role="dialog"]:not([data-order-drawer]), [role="alertdialog"]')) return true;
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
}

export function LiveSyncClient({
  viewerKey,
  role,
  cursor,
  demo,
  orderIds,
  mode = "refresh",
}: {
  viewerKey: string;
  role: LiveViewerRole;
  cursor: number;
  demo: boolean;
  /** only events for these orders matter on this page (default: any visible order) */
  orderIds?: string[];
  /** "refresh": re-read server data in place; "event": let the page fetch (driver offline app) */
  mode?: "refresh" | "event";
}) {
  const router = useRouter();
  const waiting = useRef<number | null>(null);

  const apply = useCallback(() => {
    if (waiting.current !== null) return; // already waiting for the person to finish
    const tryNow = () => {
      if (busy()) {
        waiting.current = window.setTimeout(tryNow, 700);
        return;
      }
      waiting.current = null;
      // soft refresh: server components re-render in place; client state (open panels,
      // filters, scroll, form values, 3D camera) is kept because nothing remounts
      router.refresh();
    };
    tryNow();
  }, [router]);

  const onBatch = useCallback((b: LiveBatch) => {
    const relevant = orderIds ? b.changed.filter((e) => orderIds.includes(e.order_id)) : b.changed;
    for (const t of b.toasts) {
      if (orderIds && !orderIds.includes(t.order_id)) continue;
      toast.info(t.title, { description: t.description, id: `live:${t.key}` });
      // demo only: an inspectable record of announcements (used by the E2E duplicate check)
      if (demo) ((window as unknown as { __jjLiveToasts?: string[] }).__jjLiveToasts ??= []).push(t.key);
    }
    if (!relevant.length && !b.reconcile) return;
    if (mode === "event") {
      window.dispatchEvent(new CustomEvent<LiveDomEventDetail>(LIVE_DOM_EVENT, { detail: { orderIds: relevant.map((e) => e.order_id), reconcile: b.reconcile } }));
      return;
    }
    apply();
  }, [apply, demo, mode, orderIds]);

  const status = useRealtimeOrders({ viewerKey, role, cursor, demo }, onBatch) ?? "connecting";
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="live-status"
      data-status={status}
      title={LABEL[status]}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        status === "live" ? "border-live/60 bg-live/10 text-foreground" : status === "offline" ? "border-destructive/40 text-destructive" : "text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("size-2 rounded-full", status === "live" ? "bg-live" : status === "offline" ? "bg-destructive" : "animate-pulse bg-muted-foreground")} />
      <span className="sr-only sm:not-sr-only">{LABEL[status]}</span>
    </span>
  );
}
