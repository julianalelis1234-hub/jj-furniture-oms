import { isDemoMode } from "@/lib/config";
import { liveCursorFor } from "@/lib/server/live";
import { LiveSyncClient } from "./live-sync-client";

export interface LiveOptions {
  orderIds?: string[];
  mode?: "refresh" | "event";
}

/** Server part: who is watching and which feed id this render already reflects. */
export async function LiveSync({ orderIds, mode }: LiveOptions) {
  const c = await liveCursorFor();
  if (!c) return null;
  return (
    <LiveSyncClient viewerKey={`${c.viewer.role}:${c.viewer.id}`} role={c.viewer.role} cursor={c.cursor} demo={isDemoMode()} orderIds={orderIds} mode={mode} />
  );
}
