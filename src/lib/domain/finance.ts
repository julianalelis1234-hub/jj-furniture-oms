import type { Municipality, Order, Payment } from "./types";

/** Round to centavos without floating-point drift. */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
/** Spec name for the same rounding: roundToCurrency(val) = Math.round((val + Number.EPSILON) * 100) / 100 */
export const roundToCurrency = money;

export const DOWN_PAYMENT_RATE = 0.3;

export function standardDownPayment(price: number): number {
  return money(price * DOWN_PAYMENT_RATE);
}

/** ₱0 inside Valencia City; the explicit distance fee elsewhere. */
export function effectiveDeliveryFee(municipality: Municipality, requestedFee: number): number {
  if (municipality === "Valencia City") return 0;
  return money(Math.max(0, requestedFee || 0));
}

const verified = (p: Payment) => p.verified_by_owner_or_staff;

export function furniturePaidFrom(payments: Payment[]): number {
  return money(
    payments.filter((p) => verified(p) && p.payment_type !== "Delivery Fee").reduce((s, p) => s + Number(p.amount), 0),
  );
}

export function feePaidFrom(payments: Payment[]): number {
  return money(
    payments.filter((p) => verified(p) && p.payment_type === "Delivery Fee").reduce((s, p) => s + Number(p.amount), 0),
  );
}

export interface Financials {
  delivery_fee: number;
  standard_down_payment_due: number;
  remaining_furniture_balance: number;
  collectible_on_delivery: number;
}

/**
 * Same formula as private.orders_before_write():
 *  down payment due  = 30% of price
 *  remaining balance = price − verified furniture payments
 *  collectible       = remaining balance + unpaid delivery fee
 */
export function computeFinancials(
  input: { furniture_price: number | null; delivery_fee: number; municipality: Municipality },
  payments: Payment[],
): Financials {
  // a customer request has no price until the shop quotes it: everything is ₱0 until then
  const price = input.furniture_price ?? 0;
  const delivery_fee = effectiveDeliveryFee(input.municipality, input.delivery_fee);
  const furniturePaid = furniturePaidFrom(payments);
  const feePaid = feePaidFrom(payments);
  const remaining = money(Math.max(0, price - furniturePaid));
  const overflow = money(Math.max(0, furniturePaid - price));
  return {
    delivery_fee,
    standard_down_payment_due: standardDownPayment(price),
    remaining_furniture_balance: remaining,
    collectible_on_delivery: money(remaining + Math.max(0, delivery_fee - feePaid - overflow)),
  };
}

/** Preview used by the New Order form before anything is paid. */
export function previewNewOrder(price: number, municipality: Municipality, fee: number) {
  const f = computeFinancials({ furniture_price: price, delivery_fee: fee, municipality }, []);
  const balanceAfterDown = money(price - f.standard_down_payment_due);
  return {
    ...f,
    balance_after_down_payment: balanceAfterDown,
    collectible_after_down_payment: money(balanceAfterDown + f.delivery_fee),
  };
}

/**
 * Splits cash collected on delivery into a furniture-balance payment and a
 * delivery-fee payment so both ledgers stay exact.
 */
export function splitDeliveryCollection(order: Pick<Order, "remaining_furniture_balance">, amount: number) {
  const toBalance = money(Math.min(amount, order.remaining_furniture_balance));
  const toFee = money(amount - toBalance);
  return { toBalance, toFee };
}

export function downPaymentShortfall(order: Pick<Order, "standard_down_payment_due" | "id">, payments: Payment[]) {
  return money(Math.max(0, order.standard_down_payment_due - furniturePaidFrom(payments.filter((p) => p.order_id === order.id))));
}

export function formatPeso(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(
    Number(n ?? 0),
  );
}
