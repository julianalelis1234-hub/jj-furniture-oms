import { addDays, daysBetween, todayISO } from "@/lib/domain/dates";
import { paymentDue, type PaymentDue } from "@/lib/domain/payment-due";
import { paymentGateProblem } from "@/lib/domain/payment-terms";
import { downPaymentShortfall, furniturePaidFrom, money } from "@/lib/domain/finance";
import { stageIndex } from "@/lib/domain/status";
import type {
  DeliveryAssignment,
  NotificationLog,
  Order,
  OrderException,
  OrderStatus,
  Payment,
} from "@/lib/domain/types";
import { PH_PHONE } from "@/lib/domain/validation";
import { isCustomerProposal } from "./exceptions";

export type Risk = "delayed" | "at_risk" | "on_track";

/** Delayed = past the estimated completion date and not built yet; at risk = due within 2 days. */
export function riskOf(o: Order, today: string): Risk {
  if (stageIndex(o.status) >= stageIndex("Completed / For Inspection")) return "on_track";
  if (!o.estimated_completion_date) return "on_track"; // a quote request has no date until it is quoted
  const d = daysBetween(today, o.estimated_completion_date);
  if (d < 0) return "delayed";
  if (d <= 2) return "at_risk";
  return "on_track";
}

export interface OwnerKpis {
  activeOrders: number;
  delayedOrAtRisk: number;
  inProduction: number;
  waitingInspection: number;
  deliveriesToWatch: number;
  balancesToCollect: number;
  unpaidAfterDelivery: { count: number; amount: number };
  approvalsWaiting: number;
}

export function ownerKpis(
  orders: Order[],
  deliveries: DeliveryAssignment[],
  exceptions: OrderException[],
  today: string,
): OwnerKpis {
  const active = orders.filter((o) => o.status !== "Delivered");
  const unpaid = orders.filter((o) => o.status === "Delivered" && o.collectible_on_delivery > 0);
  const tomorrow = addDays(today, 1);
  return {
    activeOrders: active.length,
    delayedOrAtRisk: active.filter((o) => riskOf(o, today) !== "on_track").length,
    inProduction: orders.filter((o) => o.status === "In Production").length,
    waitingInspection: orders.filter((o) => o.status === "Completed / For Inspection").length,
    deliveriesToWatch: deliveries.filter(
      (d) =>
        d.dispatch_status === "Failed / Reschedule" ||
        d.dispatch_status === "Out for Delivery" ||
        (d.dispatch_status === "Scheduled" && d.scheduled_date <= tomorrow),
    ).length,
    balancesToCollect: money(active.reduce((s, o) => s + o.collectible_on_delivery, 0)),
    unpaidAfterDelivery: { count: unpaid.length, amount: money(unpaid.reduce((s, o) => s + o.collectible_on_delivery, 0)) },
    approvalsWaiting: exceptions.filter((e) => e.status === "Pending" && e.category !== "Spec Clarification").length,
  };
}

export interface StaffTasks {
  /** submitted orders (online or walk-in) waiting for the shop to confirm them */
  toConfirm: Order[];
  /** confirmed orders whose official quotation has not been issued yet */
  toQuote: Order[];
  /** quotation issued; the customer has not accepted it yet */
  awaitingAcceptance: Order[];
  /** accepted + paid as the terms need (30%, full, or approved installment) + no blocking items: ready to release to the workshop */
  readyForProduction: Order[];
  /** customer-submitted online / bank payments to check and verify or reject */
  paymentsToVerify: { payment: Payment; order: Order }[];
  specProposals: OrderException[];
  /** accepted orders still owed money now, by their payment terms (30% down, full or installment) */
  awaitingPayment: ({ order: Order } & PaymentDue)[];
  missingFields: { order: Order; missing: string[] }[];
  specQuestions: OrderException[];
  toSchedule: Order[];
  failedDeliveries: { delivery: DeliveryAssignment; order: Order }[];
  cashHandovers: { payment: Payment; order: Order }[];
  touchUps: OrderException[];
  failedSms: NotificationLog[];
}

export function missingFieldsOf(o: Order): string[] {
  const out: string[] = [];
  if (!PH_PHONE.test(o.customer_phone)) out.push("valid mobile number");
  if (o.delivery_address.trim().length < 12) out.push("complete delivery address (purok / barangay / landmark)");
  if (!o.reference_photo_url) out.push("reference photo link");
  if (["Ready for Delivery", "Out for Delivery"].includes(o.status) && !o.scheduled_delivery_date) out.push("delivery date");
  return out;
}

export function staffTasks(
  orders: Order[],
  payments: Payment[],
  deliveries: DeliveryAssignment[],
  exceptions: OrderException[],
  notifications: NotificationLog[],
  today: string = todayISO(),
): StaffTasks {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const live = (orderId: string) => deliveries.some((d) => d.order_id === orderId && d.dispatch_status !== "Failed / Reschedule");
  const proposals = exceptions.filter((e) => e.status === "Pending" && isCustomerProposal(e));
  const blocked = (orderId: string) => exceptions.some((e) => e.order_id === orderId && e.status === "Pending" && e.is_production_blocking);
  return {
    toConfirm: orders
      .filter((o) => (o.status === "Quote Requested" || o.status === "Waiting for Confirmation") && !proposals.some((p) => p.order_id === o.id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    toQuote: orders.filter((o) => o.status === "Confirmed" && !o.quotation_issued_at && !proposals.some((p) => p.order_id === o.id)),
    awaitingAcceptance: orders.filter((o) => o.status === "Confirmed" && !!o.quotation_issued_at && !o.specs_confirmed && !proposals.some((p) => p.order_id === o.id)),
    readyForProduction: orders.filter(
      (o) =>
        o.status === "Confirmed" &&
        o.specs_confirmed &&
        !blocked(o.id) &&
        paymentGateProblem(o, furniturePaidFrom(payments.filter((p) => p.order_id === o.id)), "production") === null,
    ),
    paymentsToVerify: payments
      .filter((p) => !p.verified_by_owner_or_staff && !p.rejected_at && !!p.submitted_by)
      .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
      .map((payment) => ({ payment, order: byId.get(payment.order_id)! }))
      .filter((x) => x.order),
    specProposals: proposals,
    awaitingPayment: orders
      .map((order) => {
        const due = paymentDue(order, payments, today);
        return due ? { order, ...due } : null;
      })
      .filter((x): x is { order: Order } & PaymentDue => x !== null)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.order.order_code.localeCompare(b.order.order_code)),
    missingFields: orders
      .filter((o) => o.status !== "Delivered")
      .map((order) => ({ order, missing: missingFieldsOf(order) }))
      .filter((x) => x.missing.length > 0),
    specQuestions: exceptions.filter((e) => e.category === "Spec Clarification" && e.status === "Pending" && !isCustomerProposal(e)),
    toSchedule: orders.filter((o) => o.status === "Ready for Delivery" && !live(o.id)),
    failedDeliveries: deliveries
      .filter((d) => d.dispatch_status === "Failed / Reschedule" && !live(d.order_id) && byId.get(d.order_id)?.status !== "Delivered")
      .map((delivery) => ({ delivery, order: byId.get(delivery.order_id)! }))
      .filter((x) => x.order),
    cashHandovers: payments
      .filter((p) => !p.verified_by_owner_or_staff && !p.rejected_at && !p.submitted_by)
      .map((payment) => ({ payment, order: byId.get(payment.order_id)! }))
      .filter((x) => x.order),
    touchUps: exceptions.filter((e) => e.category === "On-Site Scratch Touch-Up / Repair" && e.status === "Pending"),
    failedSms: notifications.filter((n) => n.delivery_status === "Failed"),
  };
}

// ------------------------------------------------ 3-zone office workspace ----
/**
 * Stage filters of the Staff / Owner order queue, in the order work happens (migration 009):
 * confirm the submission, then quotation + payment, then the workshop, then delivery.
 */
export const QUEUE_FILTERS = [
  { key: "active", label: "All active", statuses: ["Quote Requested", "Waiting for Confirmation", "Confirmed", "In Production", "Completed / For Inspection", "Ready for Delivery", "Out for Delivery"] },
  { key: "to_confirm", label: "To confirm", statuses: ["Quote Requested", "Waiting for Confirmation"] },
  { key: "quote_payment", label: "Quotation & payment", statuses: ["Confirmed"] },
  { key: "production", label: "In production", statuses: ["In Production", "Completed / For Inspection"] },
  { key: "delivery", label: "Delivery", statuses: ["Ready for Delivery", "Out for Delivery"] },
  { key: "delivered", label: "Delivered", statuses: ["Delivered"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly OrderStatus[] }[];
export type QueueFilterKey = (typeof QUEUE_FILTERS)[number]["key"];

/**
 * The 4-metric strip, computed from the authorized order and payment rows the
 * caller can see (never hardcoded). Collected deposits = VERIFIED furniture
 * payments on active orders only: unverified driver / customer submissions and
 * delivery-fee payments never count.
 */
export function workspaceMetrics(orders: Order[], payments: Payment[]) {
  const count = (statuses: readonly OrderStatus[]) => orders.filter((o) => statuses.includes(o.status)).length;
  const active = new Set(orders.filter((o) => o.status !== "Delivered").map((o) => o.id));
  return {
    toConfirm: count(["Quote Requested", "Waiting for Confirmation"]),
    quotationAndPayment: count(["Confirmed"]),
    inWorkshop: count(["In Production", "Completed / For Inspection"]),
    delivery: count(["Ready for Delivery", "Out for Delivery"]),
    collectedDeposits: furniturePaidFrom(payments.filter((p) => active.has(p.order_id))),
    filterCounts: Object.fromEntries(QUEUE_FILTERS.map((f) => [f.key, count(f.statuses)])) as Record<QueueFilterKey, number>,
  };
}
