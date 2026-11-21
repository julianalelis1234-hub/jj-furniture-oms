import "server-only";
import type { DataStore } from "@/lib/data/store";
import type { FurnitureSpec } from "@/lib/domain/furniture";

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

/** Latest customer-proposal revision (the proposed spec) for each order with a pending proposal. */
export async function loadProposalSpecs(store: DataStore, orderIds: string[]): Promise<Record<string, FurnitureSpec>> {
  const out: Record<string, FurnitureSpec> = {};
  await Promise.all(
    [...new Set(orderIds)].map(async (id) => {
      const revs = await store.listRevisions(id);
      const p = [...revs].reverse().find((r) => r.revision_type === "customer_proposal");
      if (p)
        out[id] = {
          furniture_category: p.furniture_category, design_variant: p.design_variant, width_cm: p.width_cm, height_cm: p.height_cm,
          depth_cm: p.depth_cm, wood_type: p.wood_type, custom_wood_note: p.custom_wood_note, color_finish: p.color_finish, quantity: p.quantity,
        };
    }),
  );
  return out;
}
