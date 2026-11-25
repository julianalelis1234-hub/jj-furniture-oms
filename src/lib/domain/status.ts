import { paymentGateProblem } from "./payment-terms";
import { DomainError } from "./errors";
import type { Order, OrderStatus, Role } from "./types";
import { ORDER_STATUSES } from "./types";
import { furniturePaidFrom } from "./finance";
import type { Payment } from "./types";

/** Mirrors private.is_valid_transition() (migration 004b; 009 uses Confirmed -> In Production only). */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  "Quote Requested": ["Waiting for Confirmation"], // official quotation issued
  "Waiting for Confirmation": ["Confirmed"],
  Confirmed: ["In Production", "Waiting for Confirmation"],
  "In Production": ["Completed / For Inspection"],
  "Completed / For Inspection": ["Ready for Delivery", "In Production"],
  "Ready for Delivery": ["Out for Delivery"],
  "Out for Delivery": ["Delivered", "Ready for Delivery"],
  Delivered: [],
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** 0 = Quote Requested (pre-production), 1..7 = the seven workshop & delivery stages. */
export function stageIndex(status: OrderStatus): number {
  return ORDER_STATUSES.indexOf(status);
}

/**
 * Which roles may request a given transition (application-level authorization;
 * mirrors private.role_may_transition()). Craftsmen may only finish a build.
 */
export function rolesAllowedFor(from: OrderStatus, to: OrderStatus): Role[] {
  if (from === "Quote Requested" && to === "Waiting for Confirmation") return ["owner", "staff"];
  if (from === "Waiting for Confirmation" && to === "Confirmed") return ["owner", "staff"];
  if (from === "Confirmed" && to === "Waiting for Confirmation") return ["owner", "staff"];
  if (from === "Confirmed" && to === "In Production") return ["owner", "staff"]; // the 30% gate release
  if (from === "In Production" && to === "Completed / For Inspection") return ["owner", "staff", "craftsman"];
  if (from === "Completed / For Inspection") return ["owner"]; // inspection pass / fail
  if (from === "Ready for Delivery" && to === "Out for Delivery") return ["owner", "staff", "driver"];
  if (from === "Out for Delivery") return ["owner", "staff", "driver"];
  return [];
}

/**
 * Throws the same errors the database trigger raises. Used by the in-memory
 * store (to mirror the DB) and by services (to fail fast with clear messages).
 */
export function assertTransition(
  order: Pick<Order, "status" | "specs_confirmed" | "standard_down_payment_due" | "payment_exception_approved" | "id"> &
    Partial<Pick<Order, "quotation_issued_at" | "furniture_price" | "payment_plan">>,
  to: OrderStatus,
  payments: Payment[],
): void {
  if (order.status === to) return;
  if (!isValidTransition(order.status, to)) {
    throw new DomainError("INVALID_TRANSITION", `Cannot move an order from "${order.status}" to "${to}".`);
  }
  // migration 009: Confirmed is the shop's confirmation; acceptance comes after the quotation
  if (to === "In Production" && order.status === "Confirmed") {
    if (!order.quotation_issued_at) {
      throw new DomainError("PENDING_REVIEW", "Issue the quotation before production can start.");
    }
    if (!order.specs_confirmed) {
      throw new DomainError("SPECS_NOT_CONFIRMED", "The customer must accept the quotation before production can start.");
    }
  }
  assertDownPaymentGate(order, to, payments);
  if (to === "Out for Delivery") {
    const problem = paymentGateProblem({ furniture_price: order.furniture_price ?? null, ...order }, furniturePaidFrom(payments.filter((p) => p.order_id === order.id)), "dispatch");
    if (problem) throw new DomainError("DOWN_PAYMENT_REQUIRED", problem);
  }
}

/** The production lock: from In Production on, specification and price never change. */
export function isProductionLocked(status: OrderStatus): boolean {
  return !["Quote Requested", "Waiting for Confirmation", "Confirmed"].includes(status);
}

/** Where a Confirmed order is in the quotation and payment steps (migration 009). */
export type QuoteStep = "awaiting_quotation" | "awaiting_acceptance" | "accepted";
export function quoteStep(order: Pick<Order, "status" | "quotation_issued_at" | "specs_confirmed">): QuoteStep | null {
  if (order.status !== "Confirmed") return null;
  if (!order.quotation_issued_at) return "awaiting_quotation";
  return order.specs_confirmed ? "accepted" : "awaiting_acceptance";
}

/**
 * The wood-cutting gate: Confirmed -> In Production needs verified furniture
 * payments (server-summed, centavo-rounded) of at least 30% of the price, or an
 * owner-approved credit / installment exception. Same check as the DB trigger.
 */
export function assertDownPaymentGate(
  order: Pick<Order, "status" | "standard_down_payment_due" | "payment_exception_approved" | "id"> & Partial<Pick<Order, "furniture_price" | "payment_plan">>,
  to: OrderStatus,
  payments: Payment[],
): void {
  if (!(order.status === "Confirmed" && to === "In Production")) return;
  const problem = paymentGateProblem(
    { furniture_price: order.furniture_price ?? null, ...order },
    furniturePaidFrom(payments.filter((p) => p.order_id === order.id)),
    "production",
  );
  if (problem) throw new DomainError("DOWN_PAYMENT_REQUIRED", problem);
}

export const STATUS_SHORT: Record<OrderStatus, string> = {
  "Quote Requested": "Quote Requested",
  "Waiting for Confirmation": "Waiting",
  Confirmed: "Confirmed",
  "In Production": "In Production",
  "Completed / For Inspection": "For Inspection",
  "Ready for Delivery": "Ready",
  "Out for Delivery": "Out for Delivery",
  Delivered: "Delivered",
};

export const STATUS_CUSTOMER_COPY: Record<OrderStatus, string> = {
  "Quote Requested": "We received your design. The shop will check it and send you an official quotation.",
  "Waiting for Confirmation": "We received your order. The shop is checking your design and will confirm it soon.",
  Confirmed: "Your order is confirmed. Accept the quotation and pay your down payment so production can start.",
  "In Production": "Our craftsmen are building your furniture.",
  "Completed / For Inspection": "Building is done. The owner is checking the quality.",
  "Ready for Delivery": "Your furniture passed inspection and is ready for delivery.",
  "Out for Delivery": "Your furniture is on the way.",
  Delivered: "Delivered. Thank you for ordering from JJ Enterprises!",
};
