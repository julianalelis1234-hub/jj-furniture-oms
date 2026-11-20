import { DomainError } from "./errors";
import type { Order, OrderStatus, Role } from "./types";
import { ORDER_STATUSES } from "./types";
import { furniturePaidFrom } from "./finance";
import type { Payment } from "./types";

/** Mirrors private.is_valid_transition() in 001_init.sql. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
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

export function stageIndex(status: OrderStatus): number {
  return ORDER_STATUSES.indexOf(status);
}

/** Which roles may request a given transition (application-level authorization). */
export function rolesAllowedFor(from: OrderStatus, to: OrderStatus): Role[] {
  if (from === "Waiting for Confirmation" && to === "Confirmed") return ["owner", "staff"];
  if (from === "Confirmed" && to === "Waiting for Confirmation") return ["owner", "staff"];
  if (from === "Confirmed" && to === "In Production") return ["owner", "staff", "craftsman"];
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
  order: Pick<Order, "status" | "specs_confirmed" | "standard_down_payment_due" | "payment_exception_approved" | "id">,
  to: OrderStatus,
  payments: Payment[],
): void {
  if (order.status === to) return;
  if (!isValidTransition(order.status, to)) {
    throw new DomainError("INVALID_TRANSITION", `Cannot move an order from "${order.status}" to "${to}".`);
  }
  if ((to === "Confirmed" || to === "In Production") && !order.specs_confirmed) {
    throw new DomainError(
      "SPECS_NOT_CONFIRMED",
      "The customer must confirm the specifications before production can start.",
    );
  }
  if (to === "Out for Delivery") {
    const paid = furniturePaidFrom(payments.filter((p) => p.order_id === order.id));
    if (paid < order.standard_down_payment_due && !order.payment_exception_approved) {
      throw new DomainError(
        "DOWN_PAYMENT_REQUIRED",
        "A verified 30% down payment or an owner-approved payment exception is required before dispatch.",
      );
    }
  }
}

export const STATUS_SHORT: Record<OrderStatus, string> = {
  "Waiting for Confirmation": "Waiting",
  Confirmed: "Confirmed",
  "In Production": "In Production",
  "Completed / For Inspection": "For Inspection",
  "Ready for Delivery": "Ready",
  "Out for Delivery": "Out for Delivery",
  Delivered: "Delivered",
};

export const STATUS_CUSTOMER_COPY: Record<OrderStatus, string> = {
  "Waiting for Confirmation": "We are waiting for you to confirm the size, wood, color and price.",
  Confirmed: "Your specifications are confirmed. Your order is in the workshop queue.",
  "In Production": "Our craftsmen are building your furniture.",
  "Completed / For Inspection": "Building is done. The owner is checking the quality.",
  "Ready for Delivery": "Your furniture passed inspection and is ready for delivery.",
  "Out for Delivery": "Your furniture is on the way.",
  Delivered: "Delivered. Thank you for ordering from JJ Furniture!",
};
