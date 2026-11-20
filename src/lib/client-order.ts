import type { Order } from "@/lib/domain/types";

/** Order shape safe to send to office browsers: never includes the PIN hash. */
export type ClientOrder = Omit<Order, "pin_code_hash">;

export function toClientOrder(o: Order): ClientOrder {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pin_code_hash, ...rest } = o;
  return rest;
}
