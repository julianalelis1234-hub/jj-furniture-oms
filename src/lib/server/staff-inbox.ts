import "server-only";
import { formatPeso } from "@/lib/domain/finance";
import type { OfficeData } from "@/lib/server/office-data";
import { staffTasks } from "@/lib/services/insights";

export type InboxItem = { id: string; order: string; label: string; tab: string; kind: "confirm" | "quote" | "payment" | "workshop" | "delivery" | "question" | "fix" };

/** One line per pending office job; each opens that order's drawer on the right tab. Shared by the staff dashboard and Task inbox. */
export function staffInbox(data: OfficeData) {
  const t = staffTasks(data.orders, data.payments, data.deliveries, data.exceptions, data.notifications);
  const code = (id: string) => data.orders.find((o) => o.id === id)?.order_code ?? "";
  const items: InboxItem[] = [
    ...t.toConfirm.map((o) => ({ id: o.id, order: o.order_code, label: o.order_origin === "customer_self_service" ? "Check and confirm the online order" : "Confirm the order", tab: "quotation", kind: "confirm" as const })),
    ...t.specProposals.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Review the customer's proposed changes", tab: "overview", kind: "question" as const })),
    ...t.toQuote.map((o) => ({ id: o.id, order: o.order_code, label: "Issue the quotation", tab: "quotation", kind: "quote" as const })),
    ...t.paymentsToVerify.map(({ payment, order }) => ({ id: order.id, order: order.order_code, label: `Verify a ${payment.payment_method} payment (${formatPeso(payment.amount)}, ref. ${payment.reference_number ?? "-"})`, tab: "payments", kind: "payment" as const })),
    ...t.awaitingPayment.map(({ order, label, shortfall, overdue, stage }) => ({ id: order.id, order: order.order_code, label: stage === "installment_plan" ? "Set the installment plan" : `${overdue ? "Overdue" : "Waiting for"}: ${label} (${formatPeso(shortfall)} short)`, tab: "payments", kind: "payment" as const })),
    ...t.readyForProduction.map((o) => ({ id: o.id, order: o.order_code, label: "Release to the workshop (30% verified)", tab: "payments", kind: "workshop" as const })),
    ...t.cashHandovers.map(({ payment, order }) => ({ id: order.id, order: order.order_code, label: `Verify cash handover (${formatPeso(payment.amount)})`, tab: "payments", kind: "payment" as const })),
    ...t.specQuestions.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Answer a craftsman's question", tab: "overview", kind: "question" as const })),
    ...t.failedDeliveries.map(({ order }) => ({ id: order.id, order: order.order_code, label: "Reschedule a failed delivery", tab: "overview", kind: "delivery" as const })),
    ...t.toSchedule.filter((o) => !t.failedDeliveries.some((f) => f.order.id === o.id)).map((o) => ({ id: o.id, order: o.order_code, label: "Schedule driver & vehicle", tab: "overview", kind: "delivery" as const })),
    ...t.touchUps.map((e) => ({ id: e.order_id, order: code(e.order_id), label: "Touch-up / repair work order", tab: "overview", kind: "fix" as const })),
    ...t.missingFields.map(({ order, missing }) => ({ id: order.id, order: order.order_code, label: `Complete missing fields: ${missing.join(", ")}`, tab: "overview", kind: "fix" as const })),
    ...t.failedSms.map((n) => ({ id: n.order_id, order: code(n.order_id), label: "Retry a failed customer SMS", tab: "quotation", kind: "fix" as const })),
  ];
  return { t, items };
}

/** Live counts for the staff sidebar. */
export function staffBadges(data: OfficeData) {
  const { t, items } = staffInbox(data);
  const live = (id: string) => data.deliveries.some((d) => d.order_id === id && d.dispatch_status !== "Failed / Reschedule");
  return {
    "/staff/orders": t.toConfirm.length,
    "/staff/tasks": items.length,
    "/staff/payments": t.paymentsToVerify.length + t.cashHandovers.length,
    "/staff/deliveries": data.orders.filter((o) => o.status === "Ready for Delivery" && !live(o.id)).length,
  };
}
