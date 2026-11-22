import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeedTables, CURATED_CUSTOMER_LOGIN, demoDataset } from "@/lib/data/seed";
import { furniturePaidFrom } from "@/lib/domain/finance";
import { QUEUE_FILTERS, workspaceMetrics } from "@/lib/services/insights";
import { startProduction } from "@/lib/services/orders";
import { actors } from "./helpers";

const curated = async () => new MemoryStore(await buildSeedTables("curated"));

describe("curated Demo Mode dataset (5 orders)", () => {
  it("is the default demo dataset; the test fixtures are opt-in", () => {
    expect(demoDataset()).toBe(process.env.DEMO_DATASET === "fixtures" ? "fixtures" : "curated");
  });

  it("contains exactly the 5 specified orders, customers, items, sizes and stages", async () => {
    const s = await curated();
    const rows = (await s.listOrders()).sort((a, b) => a.order_code.localeCompare(b.order_code))
      .map((o) => [o.order_code, o.customer_name, o.item_name, `${o.width_cm}×${o.height_cm}×${o.depth_cm}`, o.color_finish, o.status]);
    expect(rows).toEqual([
      ["JJ-2026-1001", "Juliana Lelis", "Narra 6-Seater Dining Table", "200×76×95", "Natural Matte Varnish", "In Production"],
      ["JJ-2026-1002", "Rea Caday", "Solid Mahogany King Platform Bed", "190×110×210", "Warm Espresso Stain", "Waiting for Confirmation"],
      ["JJ-2026-1003", "Julian Marte", "Gmelina Modular Wardrobe Cabinet", "180×210×60", "Satin Caramel Finish", "Quote Requested"],
      ["JJ-2026-1004", "Riezbell Naquinez", "Acacia L-Shaped Executive Study Desk", "160×75×140", "Natural Oil Finish", "Ready for Delivery"],
      ["JJ-2026-1005", "Bon Ortizano", "Molave Accent Lounge Chair Pair", "72×82×78", "Mocha Hand-Rubbed Finish", "Confirmed"],
    ]);
  });

  it("financials: totals, verified deposits, 30% down payments and remaining balances (delivery fee separate)", async () => {
    const s = await curated();
    const pays = await s.listPayments();
    const f = async (code: string) => {
      const o = (await s.getOrderByCode(code))!;
      return { price: o.furniture_price, verified: furniturePaidFrom(pays.filter((p) => p.order_id === o.id)), down: o.standard_down_payment_due, remaining: o.remaining_furniture_balance, fee: o.delivery_fee };
    };
    expect(await f("JJ-2026-1001")).toEqual({ price: 38500, verified: 15000, down: 11550, remaining: 23500, fee: 0 });
    expect(await f("JJ-2026-1002")).toMatchObject({ price: 44000, verified: 0, down: 13200 });
    expect(await f("JJ-2026-1003")).toMatchObject({ price: null, verified: 0 });
    expect(await f("JJ-2026-1004")).toEqual({ price: 24800, verified: 10000, down: 7440, remaining: 14800, fee: 0 });
    expect(await f("JJ-2026-1005")).toMatchObject({ price: 19600, verified: 0, down: 5880 });
  });

  it("accounts: four verified + linked customers, Bon Ortizano is an unlinked walk-in; the demo login is Juliana", async () => {
    const s = await curated();
    const linked = (await s.listOrders()).filter((o) => o.customer_user_id && o.email_verified_at).map((o) => o.order_code).sort();
    expect(linked).toEqual(["JJ-2026-1001", "JJ-2026-1002", "JJ-2026-1003", "JJ-2026-1004"]);
    const bon = (await s.getOrderByCode("JJ-2026-1005"))!;
    expect(bon).toMatchObject({ has_no_email: true, customer_user_id: null, customer_email: null });
    expect(s.t.customer_accounts.find((a) => a.email === CURATED_CUSTOMER_LOGIN.email)?.full_name).toBe("Juliana Lelis");
    // JJ-2026-1002's quotation link is waiting in the Demo Inbox
    expect(s.t.demo_mailbox.some((m) => m.to === "rea.caday@example.com" && m.text.includes("/customer/review?token="))).toBe(true);
  });

  it("KPI strip and filter counts are computed, Quote Requested stays intake (not one of the 7 stages)", async () => {
    const s = await curated();
    const m = workspaceMetrics(await s.listOrders(), await s.listPayments());
    expect(m).toMatchObject({ needsQuoteOrAction: 2, inWorkshop: 2, delivery: 1, collectedDeposits: 25000 });
    expect(m.filterCounts).toEqual({ active: 5, needs_quote: 1, waiting: 1, production: 2, delivery: 1, delivered: 0 });
    expect(QUEUE_FILTERS.find((f) => f.key === "production")!.statuses).not.toContain("Quote Requested");
  });

  it("an UNVERIFIED payment counts toward neither the deposits KPI nor the 30% production gate", async () => {
    const s = await curated();
    const bon = (await s.getOrderByCode("JJ-2026-1005"))!;
    await s.insertPayment({ order_id: bon.id, client_transaction_id: crypto.randomUUID(), payment_type: "Down Payment (30%)", amount: 6000,
      payment_method: "Cash", collected_by_id: actors.driver.id, verified_by_owner_or_staff: false, notes: "unverified submission", paid_at: new Date().toISOString() });
    expect(workspaceMetrics(await s.listOrders(), await s.listPayments()).collectedDeposits).toBe(25000);
    await expect(startProduction(s, actors.owner, bon.id)).rejects.toThrow(/30%/);
    expect((await s.getOrder(bon.id))!.status).toBe("Confirmed");
  });
});
