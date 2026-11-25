// What each accepted order is waiting for, by the customer's payment terms:
//  - 30% down payment: the 30% (the balance is collected on delivery)
//  - Full payment: the whole furniture price (before production)
//  - Installment: no down payment; the plan must be set, then any scheduled payment that is
//    due (within 3 days) or overdue, also after delivery
// Only verified payments count. Used by the owner/staff "Payments to verify" page and the task inbox.
import { formatDate } from "./dates";
import { formatPeso, furniturePaidFrom, money } from "./finance";
import { installmentSchedule } from "./installments";
import type { Order, Payment } from "./types";

export interface PaymentDue {
  stage: "down" | "full" | "installment" | "installment_plan";
  /** short name of what is awaited, e.g. "30% down payment", "Installment · Payment 2 of 4" */
  label: string;
  /** one line of context: what is paid, the due date */
  detail: string;
  /** amount still owed for this stage (0 for "set the installment plan") */
  shortfall: number;
  overdue: boolean;
}

type DueOrder = Pick<
  Order,
  "id" | "status" | "specs_confirmed" | "payment_plan" | "furniture_price" | "standard_down_payment_due" | "payment_exception_approved"
> & Partial<Pick<Order, "installment_count" | "installment_first_due">>;

export function paymentDue(o: DueOrder, payments: Payment[], today: string): PaymentDue | null {
  if (!o.specs_confirmed || !o.payment_plan || o.furniture_price == null) return null;
  const price = Number(o.furniture_price);
  const paid = furniturePaidFrom(payments.filter((p) => p.order_id === o.id));
  if (paid >= price - 0.005) return null;
  const delivered = o.status === "Delivered";
  const paidLine = `${formatPeso(paid)} of ${formatPeso(price)} paid`;

  if (o.payment_plan === "full") {
    // after delivery an unpaid balance is tracked as a credit item; an owner exception lifts the rule
    if (delivered || o.payment_exception_approved) return null;
    return { stage: "full", label: "Full payment", overdue: false, shortfall: money(price - paid), detail: `${paidLine} · needed before production` };
  }

  if (o.payment_plan === "down_30") {
    const downDue = Number(o.standard_down_payment_due);
    const downShort = money(Math.max(0, downDue - paid));
    if (downShort <= 0 || delivered || o.payment_exception_approved) return null; // the balance is collected on delivery
    return { stage: "down", label: "30% down payment", detail: `${formatPeso(paid)} of ${formatPeso(downDue)} paid`, shortfall: downShort, overdue: false };
  }

  // installment: no down payment; payments continue after delivery
  const schedule = installmentSchedule(o, paid, today);
  if (!schedule) {
    return { stage: "installment_plan", label: "Installment · plan not set", detail: "Set the number of payments and the first due date", shortfall: 0, overdue: false };
  }
  const dueRows = schedule.filter((r) => r.state !== "paid" && r.state !== "upcoming");
  if (!dueRows.length) return null;
  const first = dueRows[0];
  const overdue = dueRows.some((r) => r.state === "overdue" || (r.state === "partial" && r.due < today));
  return {
    stage: "installment",
    label: `Installment · ${first.label}${dueRows.length > 1 ? ` (+${dueRows.length - 1} more)` : ""}`,
    detail: `${overdue ? "Overdue since" : "Due"} ${formatDate(first.due)} · ${paidLine}`,
    shortfall: money(dueRows.reduce((s, r) => s + r.amount - r.paid, 0)),
    overdue,
  };
}
