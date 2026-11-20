import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import type { Actor } from "@/lib/domain/types";
import { paymentSchema } from "@/lib/domain/validation";
import { ensureRole } from "./guard";
import { mustGetOrder } from "./orders";

/** Office-logged payments (in person / GCash screenshot) are verified immediately. */
export async function logPayment(store: DataStore, actor: Actor, raw: unknown) {
  ensureRole(actor, ["owner", "staff"], "log payments");
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const v = parsed.data;
  const order = await mustGetOrder(store, v.order_id);
  const owed = v.payment_type === "Delivery Fee" ? order.delivery_fee : order.remaining_furniture_balance;
  if (v.amount > owed + 0.001) {
    throw new DomainError("VALIDATION", `Amount exceeds what is still owed (₱${owed.toLocaleString("en-PH")}).`);
  }
  const { payment, duplicate } = await store.insertPayment({
    order_id: v.order_id,
    client_transaction_id: v.client_transaction_id,
    payment_type: v.payment_type,
    amount: v.amount,
    payment_method: v.payment_method,
    collected_by_id: actor.id,
    verified_by_owner_or_staff: true,
    notes: v.notes || null,
    paid_at: new Date().toISOString(),
  });
  return { payment, duplicate, order: await mustGetOrder(store, v.order_id) };
}

/** Driver cash is counted at the shop before it reduces the balance. */
export async function verifyCashHandover(store: DataStore, actor: Actor, paymentId: string, note?: string) {
  ensureRole(actor, ["owner", "staff"], "verify cash handovers");
  const payment = (await store.listPayments()).find((p) => p.id === paymentId);
  if (!payment) throw new DomainError("NOT_FOUND", "Payment not found.");
  if (payment.verified_by_owner_or_staff) return payment;
  return store.updatePayment(paymentId, {
    verified_by_owner_or_staff: true,
    notes: [payment.notes, `Handover verified by ${actor.full_name}${note ? `: ${note}` : ""}`].filter(Boolean).join(" · "),
  });
}
