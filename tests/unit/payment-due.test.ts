import { describe, expect, it } from "vitest";
import { paymentDue } from "@/lib/domain/payment-due";
import type { Order, Payment } from "@/lib/domain/types";

const order = (o: Partial<Order> = {}) => ({
  id: "o1", status: "Confirmed", specs_confirmed: true, payment_plan: "down_30", furniture_price: 12000,
  standard_down_payment_due: 3600, payment_exception_approved: false, installment_count: null, installment_first_due: null, ...o,
}) as Order;
const pay = (amount: number, verified = true) => ({
  order_id: "o1", amount, payment_type: "Down Payment (30%)", verified_by_owner_or_staff: verified, rejected_at: null,
}) as unknown as Payment;
const today = "2026-12-10";

describe("payment due by the customer's payment terms", () => {
  it("30% down payment: waits for the 30%, then nothing (balance on delivery)", () => {
    expect(paymentDue(order(), [pay(1000)], today)).toMatchObject({ stage: "down", label: "30% down payment", shortfall: 2600 });
    expect(paymentDue(order(), [pay(3600)], today)).toBeNull();
    expect(paymentDue(order(), [pay(3600, false)], today)?.shortfall).toBe(3600); // unverified does not count
  });

  it("full payment: waits for the whole price", () => {
    expect(paymentDue(order({ payment_plan: "full" }), [pay(3600)], today)).toMatchObject({ stage: "full", label: "Full payment", shortfall: 8400 });
    expect(paymentDue(order({ payment_plan: "full", status: "Delivered" }), [pay(3600)], today)).toBeNull();
    expect(paymentDue(order({ payment_plan: "full" }), [pay(12000)], today)).toBeNull();
  });

  it("installment: no down payment; asks for the plan, then only due or overdue payments", () => {
    const inst = (o: Partial<Order> = {}) => order({ payment_plan: "installment", ...o });
    expect(paymentDue(inst(), [], today)).toMatchObject({ stage: "installment_plan", shortfall: 0 });
    // 4 payments of 3,000 from Dec 1: Dec 1 overdue, Dec 16 upcoming
    const planned = inst({ installment_count: 4, installment_first_due: "2026-12-01", status: "Delivered" });
    expect(paymentDue(planned, [], today)).toMatchObject({ stage: "installment", label: "Installment · Payment 1 of 4", shortfall: 3000, overdue: true });
    expect(paymentDue(planned, [pay(3000)], today)).toBeNull(); // first one paid, next not due yet
  });

  it("orders not yet accepted, or with an owner exception for the 30%, are not chased for the 30%", () => {
    expect(paymentDue(order({ specs_confirmed: false }), [], today)).toBeNull();
    expect(paymentDue(order({ payment_exception_approved: true }), [], today)).toBeNull();
  });
});
