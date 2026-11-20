import "server-only";
import type { DataStore } from "@/lib/data/store";

/** Everything the Owner / Staff portals need, loaded in parallel under the caller's RLS scope. */
export async function loadOfficeData(store: DataStore) {
  const [orders, profiles, payments, deliveries, exceptions, notifications] = await Promise.all([
    store.listOrders(),
    store.listProfiles(),
    store.listPayments(),
    store.listDeliveries(),
    store.listExceptions(),
    store.listNotifications(),
  ]);
  orders.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { orders, profiles, payments, deliveries, exceptions, notifications };
}
export type OfficeData = Awaited<ReturnType<typeof loadOfficeData>>;

export function nameOf(profiles: { id: string; full_name: string }[], id: string | null | undefined) {
  return profiles.find((p) => p.id === id)?.full_name ?? "—";
}
