import { addDays, daysBetween } from "@/lib/domain/dates";
import { downPaymentShortfall, money } from "@/lib/domain/finance";
import { stageIndex } from "@/lib/domain/status";
import type {
  DeliveryAssignment,
  NotificationLog,
  Order,
  OrderException,
  Payment,
} from "@/lib/domain/types";
import { PH_PHONE } from "@/lib/domain/validation";
import { isCustomerProposal } from "./exceptions";

export type Risk = "delayed" | "at_risk" | "on_track";

/** Delayed = past the estimated completion date and not built yet; at risk = due within 2 days. */
export function riskOf(o: Order, today: string): Risk {
  if (stageIndex(o.status) >= stageIndex("Completed / For Inspection")) return "on_track";
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
  needsConfirmation: Order[];
  specProposals: OrderException[];
  needsDownPayment: { order: Order; shortfall: number }[];
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
): StaffTasks {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const live = (orderId: string) => deliveries.some((d) => d.order_id === orderId && d.dispatch_status !== "Failed / Reschedule");
  const proposals = exceptions.filter((e) => e.status === "Pending" && isCustomerProposal(e));
  return {
    needsConfirmation: orders.filter((o) => o.status === "Waiting for Confirmation" && !proposals.some((p) => p.order_id === o.id)),
    specProposals: proposals,
    needsDownPayment: orders
      .filter((o) => o.status !== "Delivered" && o.specs_confirmed && !o.payment_exception_approved)
      .map((order) => ({ order, shortfall: downPaymentShortfall(order, payments) }))
      .filter((x) => x.shortfall > 0),
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
      .filter((p) => !p.verified_by_owner_or_staff)
      .map((payment) => ({ payment, order: byId.get(payment.order_id)! }))
      .filter((x) => x.order),
    touchUps: exceptions.filter((e) => e.category === "On-Site Scratch Touch-Up / Repair" && e.status === "Pending"),
    failedSms: notifications.filter((n) => n.delivery_status === "Failed"),
  };
}
