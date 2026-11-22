"use server";

import { liveViewerAndStore } from "@/lib/server/live";
import { liveFeedFor, type LiveFeedPage } from "@/lib/services/live";

export type LiveFetchResult = ({ ok: true; viewerKey: string } & LiveFeedPage) | { ok: false; reason: "signed_out" | "invalid" | "unavailable" };

/**
 * Authoritative catch-up for the live-sync client. A Realtime message (or a
 * demo cross-tab ping) is only a hint; the browser always asks here for the
 * rows this viewer may see. Read-only: never mutates orders, payments or the
 * approval engine.
 */
export async function fetchLiveEventsAction(after: number): Promise<LiveFetchResult> {
  if (!Number.isSafeInteger(after) || after < 0) return { ok: false, reason: "invalid" };
  try {
    const vs = await liveViewerAndStore();
    if (!vs) return { ok: false, reason: "signed_out" };
    const page = await liveFeedFor(vs.store, vs.viewer, after);
    return { ok: true, viewerKey: `${vs.viewer.role}:${vs.viewer.id}`, ...page };
  } catch (e) {
    console.warn("[live-sync]", e instanceof Error ? e.message : e);
    return { ok: false, reason: "unavailable" };
  }
}
