import type { Order } from "@/lib/domain/types";

/**
 * Order shape safe to send to office browsers. The historical paper-slip PIN
 * fields (kept in the database for the audit trail, unused since migration 006)
 * are never sent.
 */
export type ClientOrder = Omit<Order, "pin_code_hash" | "pin_code_display">;

export function toClientOrder(o: Order): ClientOrder {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pin_code_hash, pin_code_display, ...rest } = o;
  return rest;
}
