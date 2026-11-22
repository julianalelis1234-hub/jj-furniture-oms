import "server-only";
import type { LiveViewer } from "@/lib/realtime/events";
import { getActor, getStore } from "./context";
import { getCustomer, getCustomerStore } from "./customer-auth";

/** The signed-in viewer and the store that carries THEIR authorization (JWT / RLS in production). */
export async function liveViewerAndStore() {
  const actor = await getActor();
  if (actor) return { viewer: { role: actor.role, id: actor.id } as LiveViewer, store: await getStore() };
  const customer = await getCustomer();
  if (customer) return { viewer: { role: "customer", id: customer.id } as LiveViewer, store: await getCustomerStore() };
  return null;
}

/** Highest feed id already reflected in the page being rendered now. */
export async function liveCursorFor(): Promise<{ viewer: LiveViewer; cursor: number } | null> {
  const vs = await liveViewerAndStore();
  if (!vs) return null;
  try {
    return { viewer: vs.viewer, cursor: await vs.store.latestLiveEventId() };
  } catch {
    return { viewer: vs.viewer, cursor: 0 };
  }
}
