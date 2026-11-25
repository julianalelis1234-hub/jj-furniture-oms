import { describe, expect, it } from "vitest";
import { installmentSchedule } from "@/lib/domain/installments";
import { verifyPayment, setInstallmentPlan } from "@/lib/services/payments";
import { actors, seededStore } from "./helpers";

describe("installment schedule (30% down, then equal payments every 15 days)", () => {
  const o = { furniture_price: 20000, standard_down_payment_due: 6000, installment_count: 3, installment_first_due: "2026-12-10" };
  it("splits the balance exactly and applies verified payments in order", () => {
    const rows = installmentSchedule(o, 0, "2026-11-25")!;
    expect(rows.map((r) => [r.label, r.due, r.amount])).toEqual([
      ["30% down payment", null, 6000],
      ["Payment 1 of 3", "2026-12-10", 4666.66],
      ["Payment 2 of 3", "2026-12-25", 4666.66],
      ["Payment 3 of 3", "2027-01-09", 4666.68],
    ]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(20000, 2);
    const later = installmentSchedule(o, 8000, "2026-12-27")!;
    expect(later.map((r) => r.state)).toEqual(["paid", "partial", "overdue", "upcoming"]);
    expect(later[1].paid).toBe(2000);
    expect(installmentSchedule({ ...o, installment_count: null }, 0, "2026-11-25")).toBeNull();
  });
});

describe("verifier is recorded", () => {
  it("verifying a payment stores who and when; it cannot be changed afterwards", async () => {
    const store = await seededStore();
    const order = (await store.listOrders()).find((o) => o.furniture_price != null && o.remaining_furniture_balance > 100)!;
    const { payment: pending } = await store.insertPayment({
      order_id: order.id, client_transaction_id: crypto.randomUUID(), payment_type: "Installment / Partial", amount: 100,
      payment_method: "Cash", collected_by_id: actors.driver.id, verified_by_owner_or_staff: false, notes: null, paid_at: new Date().toISOString(),
    });
    const v = await verifyPayment(store, actors.owner, pending.id);
    expect(v.verified_by_id).toBe(actors.owner.id);
    expect(v.verified_at).toMatch(/^\d{4}-/);
    await expect(store.updatePayment(pending.id, { verified_by_id: actors.staff.id })).rejects.toThrow(/recorded once/);
  });

  it("only owner/staff set a plan, only for installment orders, 2–6 payments", async () => {
    const store = await seededStore();
    const order = (await store.listOrders()).find((o) => o.furniture_price != null && o.payment_plan !== "installment");
    if (order) await expect(setInstallmentPlan(store, actors.owner, order.id, 3, "2099-01-01")).rejects.toThrow(/did not choose installment/);
    const inst = (await store.listOrders()).find((o) => o.furniture_price != null);
    if (!inst) return;
    await store.updateOrder(inst.id, { payment_plan: "installment" });
    await expect(setInstallmentPlan(store, actors.owner, inst.id, 9, "2099-01-01")).rejects.toThrow(/2 to 6/);
    await expect(setInstallmentPlan(store, actors.owner, inst.id, 3, "2000-01-01")).rejects.toThrow(/past/);
    await expect(setInstallmentPlan(store, actors.craftsman, inst.id, 3, "2099-01-01")).rejects.toThrow();
    const saved = await setInstallmentPlan(store, actors.staff, inst.id, 4, "2099-01-01");
    expect(saved).toMatchObject({ installment_count: 4, installment_first_due: "2099-01-01", installment_set_by: actors.staff.id });
  });
});
