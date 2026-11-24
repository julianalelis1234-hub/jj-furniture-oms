import "server-only";
import type { DataStore } from "@/lib/data/store";
import type { FurnitureSpec } from "@/lib/domain/furniture";
import { isCustomerProposal } from "@/lib/services/exceptions";

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

/** Owner pages: office data + inventory + the live counts shown on the sidebar. */
export async function loadOwnerContext(store: DataStore) {
  const [data, lumberItems, lumberMovements] = await Promise.all([loadOfficeData(store), store.listLumberItems(), store.listLumberMovements()]);
  const decisions = data.exceptions.filter((e) => e.status === "Pending" && (["Installment Approval", "Credit / Unpaid Balance", "Special Delivery Terms"].includes(e.category) || isCustomerProposal(e))).length
    + data.orders.filter((o) => o.status === "Completed / For Inspection").length;
  const lowStock = lumberItems.filter((i) => i.is_active && i.on_hand_bf <= i.reorder_level_bf).length;
  const live = (id: string) => data.deliveries.some((d) => d.order_id === id && d.dispatch_status !== "Failed / Reschedule");
  const toSchedule = data.orders.filter((o) => o.status === "Ready for Delivery" && !live(o.id)).length;
  const unassigned = data.orders.filter((o) => (o.status === "Confirmed" && o.specs_confirmed || o.status === "In Production") && !o.assigned_craftsman_id).length;
  const toConfirm = data.orders.filter((o) => o.status === "Waiting for Confirmation" || o.status === "Quote Requested").length;
  const badges: Record<string, number> = {
    "/owner": decisions, "/owner/orders": toConfirm, "/owner/craftsmen": unassigned, "/owner/deliveries": toSchedule, "/owner/inventory": lowStock,
  };
  return { data, lumberItems, lumberMovements, badges };
}
