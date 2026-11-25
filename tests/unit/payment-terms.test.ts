import { describe, expect, it } from "vitest";
import { collectOnDelivery, paymentGateProblem, requiredBeforeStart } from "@/lib/domain/payment-terms";
import type { Order } from "@/lib/domain/types";

const o = (x: Partial<Order> = {}) => ({
  furniture_price: 12000, standard_down_payment_due: 3600, payment_exception_approved: false, payment_plan: "down_30",
  remaining_furniture_balance: 12000, collectible_on_delivery: 12000, installment_count: null, installment_first_due: null, ...x,
}) as Order;

describe("payment rules follow the customer's terms", () => {
  it("30% down payment: the 30% before production and dispatch", () => {
    expect(requiredBeforeStart(o())).toBe(3600);
    expect(paymentGateProblem(o(), 3599, "production")).toMatch(/30% down payment/);
    expect(paymentGateProblem(o(), 3600, "production")).toBeNull();
    expect(paymentGateProblem(o(), 0, "dispatch")).toMatch(/30% down payment/);
  });

  it("full payment: the whole price before production", () => {
    const f = o({ payment_plan: "full" });
    expect(requiredBeforeStart(f)).toBe(12000);
    expect(paymentGateProblem(f, 3600, "production")).toMatch(/full payment \(₱12,000\)/);
    expect(paymentGateProblem(f, 12000, "production")).toBeNull();
  });

  it("installment: no money rule, the owner's approval instead", () => {
    const i = o({ payment_plan: "installment" });
    expect(requiredBeforeStart(i)).toBe(0);
    expect(paymentGateProblem(i, 0, "production")).toMatch(/owner must approve the installment plan/);
    expect(paymentGateProblem({ ...i, payment_exception_approved: true }, 0, "production")).toBeNull();
    expect(paymentGateProblem({ ...i, payment_exception_approved: true }, 0, "dispatch")).toBeNull();
  });

  it("an owner-approved exception lifts the amount rule", () => {
    expect(paymentGateProblem(o({ payment_exception_approved: true }), 0, "production")).toBeNull();
    expect(paymentGateProblem(o({ payment_plan: "full", payment_exception_approved: true }), 0, "dispatch")).toBeNull();
  });

  it("rider collects only installments due by the delivery day (plus any fee)", () => {
    const i = o({ payment_plan: "installment", installment_count: 4, installment_first_due: "2026-12-18", collectible_on_delivery: 12500 });
    expect(collectOnDelivery(i, "2026-12-16")).toBe(500); // nothing due yet, only the delivery fee
    expect(collectOnDelivery(i, "2026-12-18")).toBe(3500); // payment 1 due that day
    expect(collectOnDelivery(o({ payment_plan: "installment" }), "2026-12-16")).toBe(0); // no schedule yet
    expect(collectOnDelivery(o({ remaining_furniture_balance: 8400, collectible_on_delivery: 8400 }), "2026-12-16")).toBe(8400);
  });
});
