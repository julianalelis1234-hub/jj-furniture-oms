import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  enqueueAction,
  flushQueue,
  getManifest,
  listQueue,
  openDriverDb,
  resolveConflict,
  saveManifest,
} from "@/lib/offline/driver-db";
import { applyDriverAction, driverManifest, type DriverAction } from "@/lib/services/deliveries";
import { customerOrderView, trackOrder } from "@/lib/services/customer";
import { editOrderDetails } from "@/lib/services/orders";
import { actors, customerAccept, seededStore } from "./helpers";

describe("3. customer authentication & privacy", () => {
  it("Order-ID-only lookup strips phone, address and money", async () => {
    const store = await seededStore();
    const t = (await trackOrder(store, "jj-2026-0136"))!;
    expect(Object.keys(t).sort()).toEqual(
      ["estimated_completion_date", "item_name", "order_code", "scheduled_delivery_date", "status", "updated_at"].sort(),
    );
    expect(JSON.stringify(t)).not.toMatch(/0900|Purok|45000|31500|33000/);
  });
  it("legacy paper-slip PINs: rejects invalid PINs and locks after 5 failures", async () => {
    const store = await seededStore();
    expect((await store.customerVerifyPin("JJ-2026-0133", "0000", "ip-a")).ok).toBe(false);
    expect((await store.customerVerifyPin("JJ-2026-0133", "1357", "ip-a")).ok).toBe(true);
    // orders created with email authentication have no PIN at all
    expect((await store.customerVerifyPin("JJ-2026-0136", "2468", "ip-a")).ok).toBe(false);
    for (let i = 0; i < 5; i++) await store.customerVerifyPin("JJ-2026-0133", "9999", "ip-b");
    const locked = await store.customerVerifyPin("JJ-2026-0133", "1357", "ip-b");
    expect(locked.ok).toBe(false);
    expect(locked.locked).toBe(true);
  });
  it("verified view exposes this order only and never the PIN hash", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0145"))!;
    const v = await customerOrderView(store, o.id);
    expect(v.order_code).toBe("JJ-2026-0145");
    expect(JSON.stringify(v)).not.toContain("pin_code");
    expect(v.payment.remaining_furniture_balance).toBe(19950);
  });
  it("customers confirm specs from the portal (gate opens)", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("DR-0148"))!;
    const confirmed = await customerAccept(store, o.id);
    expect(confirmed.status).toBe("Confirmed");
    expect(confirmed.order_code).toBe(`JJ-${new Date().getFullYear()}-0148`);
    const [c] = await store.listConfirmations(o.id);
    expect(c.confirmation_method).toBe("Customer Portal PIN");
    expect(c.revision_number).toBe(1);
    expect(c.confirmed_specs_snapshot.furniture_price).toBe(18000);
  });
  it("craftsman workshop data contains no financial or contact fields", async () => {
    const store = await seededStore();
    const rows = await store.listWorkshopOrders();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const keys = Object.keys(r).join(",");
      expect(keys).not.toMatch(/price|balance|fee|collectible|payment|phone|address|pin/);
    }
  });
});

describe("5. offline synchronization", () => {
  async function setup(name: string) {
    const store = await seededStore();
    const db = await openDriverDb(name);
    await saveManifest(db, await driverManifest(store, actors.driver), actors.driver.id);
    const send = (a: DriverAction) => applyDriverAction(store, actors.driver, a);
    return { store, db, send };
  }
  const action = (entry: Awaited<ReturnType<typeof getManifest>>[number], type: DriverAction["type"], extra: Partial<DriverAction> = {}): DriverAction => ({
    client_transaction_id: crypto.randomUUID(),
    type,
    delivery_id: entry.delivery.id,
    order_id: entry.order.id,
    base_version: entry.order.version,
    queued_at: new Date().toISOString(),
    ...extra,
  });

  it("pre-loaded manifest only contains this driver's deliveries", async () => {
    const { db, store } = await setup("t-manifest");
    const m = await getManifest(db);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((e) => e.delivery.driver_id === actors.driver.id)).toBe(true);
    expect(await driverManifest(store, actors.otherDriver)).toHaveLength(1);
  });

  it("queues actions in IndexedDB while offline and syncs sequentially when online", async () => {
    const { db, send, store } = await setup("t-queue");
    const entry = (await getManifest(db)).find((e) => e.order.order_code === "JJ-2026-0138")!;
    await enqueueAction(db, action(entry, "start_trip"));
    await enqueueAction(db, action(entry, "delivered", { amount_collected: 5600, payment_method: "Cash" }));
    expect(await listQueue(db)).toHaveLength(2);
    expect((await getManifest(db)).find((e) => e.delivery.id === entry.delivery.id)!.local_pending).toBe(true);

    const offline = await flushQueue(db, async () => { throw new TypeError("Failed to fetch"); });
    expect(offline.networkError).toBe(true);
    expect(await listQueue(db)).toHaveLength(2);

    const summary = await flushQueue(db, send);
    expect(summary).toMatchObject({ applied: 2, conflicts: 0, remaining: 0 });
    const o = (await store.getOrderByCode("JJ-2026-0138"))!;
    expect(o.status).toBe("Delivered");
    const pays = (await store.listPayments(o.id)).filter((p) => !p.verified_by_owner_or_staff);
    expect(pays.map((p) => p.amount)).toEqual([5600]);
  });

  it("replaying the same client_transaction_id creates no duplicates", async () => {
    const { db, send, store } = await setup("t-dupe");
    const entry = (await getManifest(db)).find((e) => e.order.order_code === "JJ-2026-0136")!;
    const a = action(entry, "delivered", { amount_collected: 33000 });
    expect((await send(a)).status).toBe("applied");
    expect((await send(a)).status).toBe("duplicate");
    expect((await send(a)).status).toBe("duplicate");
    const pays = (await store.listPayments(entry.order.id)).filter((p) => !p.verified_by_owner_or_staff);
    expect(pays.map((p) => [p.payment_type, p.amount])).toEqual([
      ["Delivery Balance Collection", 31500],
      ["Delivery Fee", 1500],
    ]);
    expect((await store.listHistory(entry.order.id)).filter((h) => h.client_transaction_id === a.client_transaction_id)).toHaveLength(1);
  });

  it("flags a conflict instead of overwriting a staff change made while offline", async () => {
    const { db, send, store } = await setup("t-conflict");
    const entry = (await getManifest(db)).find((e) => e.order.order_code === "JJ-2026-0138")!;
    await enqueueAction(db, action(entry, "start_trip"));
    // meanwhile at the shop, Gilbert corrects the address
    const o = (await store.getOrder(entry.order.id))!;
    await editOrderDetails(store, actors.staff, o.id, {
      customer_email: o.customer_email ?? "", has_no_email: o.has_no_email,
      customer_phone: o.customer_phone, delivery_address: "Purok 7, Brgy. Poblacion — NEW: blue gate beside sari-sari store",
      municipality: o.municipality, delivery_fee: 0, estimated_completion_date: o.estimated_completion_date,
      scheduled_delivery_date: o.scheduled_delivery_date ?? "",
    });
    const s = await flushQueue(db, send);
    expect(s.conflicts).toBe(1);
    const [item] = await listQueue(db);
    expect(item.state).toBe("conflict");
    expect((await store.getOrder(o.id))!.status).toBe("Ready for Delivery"); // not silently applied

    await resolveConflict(db, item.client_transaction_id, "reapply");
    expect((await flushQueue(db, send)).applied).toBe(1);
    expect((await store.getOrder(o.id))!.status).toBe("Out for Delivery");
  });

  it("drivers cannot act on deliveries assigned to someone else", async () => {
    const { db, store } = await setup("t-foreign");
    const entry = (await getManifest(db))[0];
    const r = await applyDriverAction(store, actors.otherDriver, action(entry, "start_trip"));
    expect(r.status).toBe("rejected");
  });

  it("failed delivery with touch-up returns the order and files a repair", async () => {
    const { db, send, store } = await setup("t-failed");
    const entry = (await getManifest(db)).find((e) => e.order.order_code === "JJ-2026-0136")!;
    await enqueueAction(db, action(entry, "failed", { notes: "Scratch on armrest from rough road", needs_touch_up: true }));
    expect((await flushQueue(db, send)).applied).toBe(1);
    expect((await store.getOrder(entry.order.id))!.status).toBe("Ready for Delivery");
    const ex = (await store.listExceptions(entry.order.id)).find((e) => e.category === "On-Site Scratch Touch-Up / Repair");
    expect(ex?.description).toContain("armrest");
  });
});
