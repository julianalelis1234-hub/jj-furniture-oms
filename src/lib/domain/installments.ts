// Installment plan (migrations 013 + 014): the whole furniture price in 2–6 equal payments
// every 15 days from the first due date, with no down payment. Set by the owner or staff
// after the customer chooses "Installment"; the owner approves the plan before production.
// Verified furniture payments are applied in order, so each row shows what is paid and
// what is still due.
import { addDays } from "./dates";

export const INSTALLMENT_MIN = 2;
export const INSTALLMENT_MAX = 6;
export const INSTALLMENT_EVERY_DAYS = 15;

export interface InstallmentRow {
  label: string;
  due: string; // YYYY-MM-DD
  amount: number;
  paid: number;
  state: "paid" | "partial" | "due" | "overdue" | "upcoming";
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The schedule, or null when the order has no plan (or no price yet). */
export function installmentSchedule(
  o: { furniture_price: number | null; installment_count?: number | null; installment_first_due?: string | null },
  verifiedFurniturePaid: number,
  today: string,
): InstallmentRow[] | null {
  if (o.furniture_price == null || !o.installment_count || !o.installment_first_due) return null;
  const n = Math.min(INSTALLMENT_MAX, Math.max(INSTALLMENT_MIN, o.installment_count));
  const total = cents(o.furniture_price);
  const each = Math.floor((total / n) * 100) / 100;
  const rows: { label: string; due: string; amount: number }[] = [];
  for (let i = 0; i < n; i++) {
    // the last payment takes the centavos left over, so the total is exact
    const amount = i === n - 1 ? cents(total - each * (n - 1)) : each;
    rows.push({ label: `Payment ${i + 1} of ${n}`, due: addDays(o.installment_first_due, i * INSTALLMENT_EVERY_DAYS), amount });
  }
  let left = cents(verifiedFurniturePaid);
  return rows.map((r) => {
    const paid = cents(Math.min(r.amount, Math.max(0, left)));
    left = cents(left - paid);
    const state: InstallmentRow["state"] =
      paid >= r.amount - 0.005 ? "paid"
      : paid > 0 ? "partial"
      : r.due < today ? "overdue"
      : r.due <= addDays(today, 3) ? "due"
      : "upcoming";
    return { ...r, paid, state };
  });
}
