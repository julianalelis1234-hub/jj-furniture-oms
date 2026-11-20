import type { Order } from "@/lib/domain/types";

/** Draft codes (DR-0148) are used until the customer confirms specifications. */
export function nextDraftCode(orders: Pick<Order, "order_code">[]): string {
  return `DR-${String(nextSequence(orders)).padStart(4, "0")}`;
}

/** Permanent codes (JJ-2026-0145) are issued on confirmation. Sequence is shared with drafts. */
export function nextOrderCode(orders: Pick<Order, "order_code">[], year: number, draftCode?: string): string {
  const draftSeq = draftCode?.match(/^DR-(\d{4})$/)?.[1];
  if (draftSeq) {
    const candidate = `JJ-${year}-${draftSeq}`;
    if (!orders.some((o) => o.order_code === candidate)) return candidate;
  }
  return `JJ-${year}-${String(nextSequence(orders)).padStart(4, "0")}`;
}

function nextSequence(orders: Pick<Order, "order_code">[]): number {
  let max = 0;
  for (const { order_code } of orders) {
    const m = order_code.match(/(?:^DR-|^JJ-\d{4}-)(\d{4})$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
