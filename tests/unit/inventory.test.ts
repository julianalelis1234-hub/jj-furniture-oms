import { describe, expect, it } from "vitest";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DomainError } from "@/lib/domain/errors";
import { addLumberItem, boardFeet, inventorySummary, recordLumberMovement, setReorderLevel, stockLevel } from "@/lib/services/inventory";
import { assignCraftsman } from "@/lib/services/orders";
import { actors, readyForAcceptance, seededStore, staffAccept, validOrderInput } from "./helpers";
import { createOrder } from "@/lib/services/orders";

const err = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as DomainError; }
  throw new Error("expected an error");
};
const txn = () => crypto.randomUUID();

describe("lumber & inventory (migration 010 mirror)", () => {
  it("board feet = thickness × width × length ÷ 12 × pieces", () => {
    expect(boardFeet(2, 4, 10)).toBe(6.67);
    expect(boardFeet(2, 4, 10, 10)).toBe(66.67);
    expect(boardFeet(1, 12, 8, 3)).toBe(24);
  });

  it("seed: on-hand is the sum of its movements and two items are low", async () => {
    const store = (await seededStore()) as MemoryStore;
    for (const i of store.t.lumber_stock_items) {
      const sum = store.t.lumber_movements.filter((m) => m.item_id === i.id).reduce((s, m) => s + (m.kind === "use" ? -m.board_feet : m.board_feet), 0);
      expect(i.on_hand_bf).toBeCloseTo(sum, 2);
    }
    const s = inventorySummary(store.t.lumber_stock_items, store.t.lumber_movements);
    expect(s.lowStock.map((i) => i.wood_name).sort()).toEqual(["Acacia", "Gmelina"]);
    expect(stockLevel({ on_hand_bf: 0, reorder_level_bf: 10 })).toBe("out");
  });

  it("only the owner adds items and changes reorder levels; staff record movements", async () => {
    const store = await seededStore();
    expect((await err(addLumberItem(store, actors.staff, { wood_name: "Yakal", reorder_level_bf: 20 }))).code).toBe("FORBIDDEN");
    const item = await addLumberItem(store, actors.owner, { wood_name: "Yakal", size_note: '2" × 2" × 8 ft', reorder_level_bf: 20 });
    expect(item.on_hand_bf).toBe(0);
    expect((await err(addLumberItem(store, actors.owner, { wood_name: "yakal", size_note: '2" × 2" × 8 ft', reorder_level_bf: 1 }))).code).toBe("VALIDATION");
    expect((await err(setReorderLevel(store, actors.staff, item.id, 5))).code).toBe("FORBIDDEN");
    expect((await setReorderLevel(store, actors.owner, item.id, 30)).reorder_level_bf).toBe(30);
    expect((await err(recordLumberMovement(store, actors.craftsman, { item_id: item.id, kind: "receive", board_feet: 10, client_transaction_id: txn() }))).code).toBe("FORBIDDEN");
    await recordLumberMovement(store, actors.staff, { item_id: item.id, kind: "receive", pieces: 12, thickness_in: 2, width_in: 2, length_ft: 8, client_transaction_id: txn() });
    expect((await store.listLumberItems()).find((i) => i.id === item.id)!.on_hand_bf).toBe(32);
  });

  it("never below zero; adjustments need a reason; replays are idempotent; uses can name an order", async () => {
    const store = await seededStore();
    const item = (await store.listLumberItems()).find((i) => i.wood_name === "Molave")!;
    expect((await err(recordLumberMovement(store, actors.staff, { item_id: item.id, kind: "use", board_feet: item.on_hand_bf + 1, client_transaction_id: txn() }))).code).toBe("INSUFFICIENT_STOCK");
    expect((await err(recordLumberMovement(store, actors.staff, { item_id: item.id, kind: "adjust", board_feet: -3, client_transaction_id: txn() }))).code).toBe("VALIDATION");
    expect((await err(recordLumberMovement(store, actors.staff, { item_id: item.id, kind: "use", board_feet: 5, order_code: "JJ-1999-0001", client_transaction_id: txn() }))).message).toMatch(/not found/);
    const key = txn();
    const a = await recordLumberMovement(store, actors.staff, { item_id: item.id, kind: "use", board_feet: 10, order_code: "JJ-2026-0145", client_transaction_id: key });
    const b = await recordLumberMovement(store, actors.staff, { item_id: item.id, kind: "use", board_feet: 10, order_code: "JJ-2026-0145", client_transaction_id: key });
    expect(b.duplicate).toBe(true);
    expect(a.movement.order_id).toBe((await store.getOrderByCode("JJ-2026-0145"))!.id);
    expect((await store.listLumberItems()).find((i) => i.id === item.id)!.on_hand_bf).toBeCloseTo(item.on_hand_bf - 10, 2);
    expect((await err(store.updateLumberItem(item.id, { on_hand_bf: 9999 } as never))).code).toBe("IMMUTABLE_RECORD");
  });
});

describe("craftsman assignment", () => {
  it("owner / staff assign an active craftsman to an accepted job; it is in the history", async () => {
    const store = await seededStore();
    const { order } = await createOrder(store, actors.staff, validOrderInput());
    expect((await err(assignCraftsman(store, actors.owner, order.id, actors.craftsman.id))).code).toBe("VALIDATION"); // not confirmed yet
    await readyForAcceptance(store, order.id);
    await staffAccept(store, actors.staff, order.id);
    expect((await err(assignCraftsman(store, actors.craftsman, order.id, actors.craftsman.id))).code).toBe("FORBIDDEN");
    expect((await err(assignCraftsman(store, actors.owner, order.id, actors.driver.id))).code).toBe("VALIDATION");
    const o = await assignCraftsman(store, actors.owner, order.id, actors.craftsman.id);
    expect(o.assigned_craftsman_id).toBe(actors.craftsman.id);
    expect((await store.listHistory(order.id))[0].notes).toBe("Assigned to Nolito Remulta");
  });
});
