import type { DataStore } from "@/lib/data/store";
import { visibleTo, type LiveEvent, type LiveViewer } from "@/lib/realtime/events";

export const LIVE_PAGE = 200;

export interface LiveFeedPage {
  events: LiveEvent[];
  /** highest feed id examined; the client asks for ids after this next time */
  cursor: number;
  /** more than one page was waiting: the client re-fetches the page data instead of replaying */
  truncated: boolean;
}

/**
 * Feed rows for one viewer. `store` must be the viewer's own store (staff JWT,
 * customer JWT, or the demo store): in production RLS on order_live_events has
 * already filtered the rows; the same rules are applied again here so the demo
 * store (and any service-role store) can never widen what a role receives.
 */
export async function liveFeedFor(store: DataStore, viewer: LiveViewer, after: number): Promise<LiveFeedPage> {
  const raw = await store.listLiveEvents(Math.max(0, Math.floor(after)), LIVE_PAGE + 1);
  const page = raw.slice(0, LIVE_PAGE);
  const ctx: { owned?: Set<string>; assigned?: Set<string> } = {};
  if (viewer.role === "customer") ctx.owned = new Set((await store.listCustomerOrders(viewer.id)).filter((o) => o.customer_user_id === viewer.id).map((o) => o.id));
  if (viewer.role === "driver") ctx.assigned = new Set((await store.listDeliveries({ driverId: viewer.id })).map((d) => d.order_id));
  return {
    events: page.filter((e) => visibleTo(e, viewer, ctx)),
    cursor: page.at(-1)?.id ?? Math.max(0, Math.floor(after)),
    truncated: raw.length > LIVE_PAGE,
  };
}
