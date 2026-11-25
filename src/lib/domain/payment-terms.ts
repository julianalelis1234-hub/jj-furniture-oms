// What must be paid before the workshop starts and before the rider leaves, by the
// customer's payment terms (migration 014; the database trigger runs the same check):
//  - 30% down payment (and orders without terms yet): the verified 30%
//  - Full payment: the whole furniture price, verified
//  - Installment: no down payment; the owner approves the installment plan
// An owner-approved payment exception (credit / pay later) lifts the amount rule.
import { formatPeso, money } from "./finance";
import { installmentSchedule } from "./installments";
import type { Order, PaymentPlan } from "./types";

export type GateOrder = Pick<Order, "furniture_price" | "standard_down_payment_due" | "payment_exception_approved"> & {
  payment_plan?: PaymentPlan | null;
};

/** The verified furniture amount the terms need before production / dispatch (0 = no amount rule). */
export function requiredBeforeStart(o: GateOrder): number {
  if (o.payment_exception_approved) return 0;
  if (o.payment_plan === "installment") return 0;
  if (o.payment_plan === "full") return money(Number(o.furniture_price ?? 0));
  return money(Number(o.standard_down_payment_due ?? 0));
}

/** The short name of what the terms need, e.g. "30% down payment". */
export function requiredLabel(o: GateOrder): string {
  return o.payment_plan === "full" ? "full payment" : o.payment_plan === "installment" ? "owner's approval of the installment plan" : "30% down payment";
}

/** Why the order may not start production / leave the shop yet, or null when it may. */
export function paymentGateProblem(o: GateOrder, verifiedPaid: number, when: "production" | "dispatch"): string | null {
  if (o.payment_plan === "installment") {
    return o.payment_exception_approved ? null : `The owner must approve the installment plan before ${when === "production" ? "production" : "dispatch"}.`;
  }
  const need = requiredBeforeStart(o);
  if (verifiedPaid >= need - 0.005) return null;
  if (o.payment_plan === "full") {
    return `The full payment (${formatPeso(need)}) must be verified before ${when === "production" ? "production" : "dispatch"}. Verified so far: ${formatPeso(verifiedPaid)}.`;
  }
  return when === "production"
    ? `A verified 30% down payment (₱${need.toLocaleString("en-PH")}) is required before production. Verified so far: ₱${verifiedPaid.toLocaleString("en-PH")}.`
    : "A verified 30% down payment or an owner-approved payment exception is required before dispatch.";
}

/** How much of the requirement is still missing (0 for installment, which needs approval, not money). */
export function gateShortfall(o: GateOrder, verifiedPaid: number): number {
  return money(Math.max(0, requiredBeforeStart(o) - verifiedPaid));
}

/**
 * What the rider collects at the door. Installment orders: only the payments due by the
 * delivery day (the rest follows the schedule) plus any unpaid delivery fee; other terms:
 * the whole remaining balance plus fee (the database's collectible_on_delivery).
 */
export function collectOnDelivery(
  o: Pick<Order, "furniture_price" | "remaining_furniture_balance" | "collectible_on_delivery"> &
    Partial<Pick<Order, "payment_plan" | "installment_count" | "installment_first_due">>,
  day: string,
): number {
  if (o.payment_plan !== "installment") return o.collectible_on_delivery;
  const price = Number(o.furniture_price ?? 0);
  const feePart = money(Math.max(0, o.collectible_on_delivery - o.remaining_furniture_balance));
  const schedule = installmentSchedule(o, money(price - o.remaining_furniture_balance), day);
  // no schedule set yet: nothing is due by date, the shop collects by agreement
  const due = schedule ? schedule.filter((r) => r.due <= day).reduce((s, r) => s + r.amount - r.paid, 0) : 0;
  return money(due + feePart);
}
