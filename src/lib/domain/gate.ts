import { DomainError } from "./errors";
import { QUOTE_REVISION_TYPES } from "./types";
import type { Order, OrderException, OrderStatus, SpecRevision } from "./types";

export const SPEC_COLUMNS = [
  "furniture_category",
  "design_variant",
  "width_cm",
  "height_cm",
  "depth_cm",
  "wood_type",
  "custom_wood_note",
  "color_finish",
  "quantity",
] as const;

const eq = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && typeof a !== "string" && Number(a) === Number(b));

/** True when an order update touches the authoritative spec or the quote. */
export function specOrQuoteChanged(before: Order, after: Order): boolean {
  return (
    SPEC_COLUMNS.some((k) => !eq(before[k], after[k])) ||
    !eq(before.furniture_price, after.furniture_price) ||
    !eq(before.delivery_fee, after.delivery_fee)
  );
}

/** Pending items that block confirmation and the start of production. */
export function blockingItems(orderId: string, exceptions: OrderException[]): OrderException[] {
  return exceptions.filter((e) => e.order_id === orderId && e.status === "Pending" && e.is_production_blocking);
}

/**
 * The approval gate — identical to private.orders_before_write() (migration
 * 004b). Called whenever an order moves into Confirmed or In Production:
 *  1. the customer accepted the LATEST revision and its quotation
 *  2. that revision is an issued shop quotation (staff_draft / revised_quote)
 *  3. staff/owner review is complete (price and paper slip recorded)
 *  4. no unresolved production-blocking items
 *  5. no price / specification drift since acceptance
 * (Confirmed -> In Production additionally needs the verified 30% down
 *  payment: see assertDownPaymentGate in status.ts.)
 */
export function assertProductionGate(order: Order, revisions: SpecRevision[], exceptions: OrderException[], from?: OrderStatus): void {
  if (!order.specs_confirmed) {
    throw new DomainError("SPECS_NOT_CONFIRMED", "The customer must accept the specifications and quotation first.");
  }
  if (order.approved_revision_number == null || order.approved_revision_number !== order.current_revision) {
    throw new DomainError("STALE_REVISION", "The accepted revision is not the latest specification. Ask the customer to accept the latest revision.");
  }
  const rev = revisions.find((r) => r.order_id === order.id && r.revision_number === order.approved_revision_number);
  if (!rev || !QUOTE_REVISION_TYPES.includes(rev.revision_type)) {
    throw new DomainError("PENDING_REVIEW", "The approved revision has not been quoted by the shop yet.");
  }
  if (order.furniture_price == null || order.paper_slip_number == null) {
    throw new DomainError("PENDING_REVIEW", "Staff/owner review (price and paper slip) is not complete.");
  }
  // blocking items stop Waiting -> Confirmed and Confirmed -> In Production (not a re-entry after a failed inspection)
  const checksBlocking = order.status === "Confirmed" || from === "Confirmed";
  if (checksBlocking && blockingItems(order.id, exceptions).length > 0) {
    throw new DomainError("PENDING_REVIEW", "Resolve the open production-blocking items for this order first.");
  }
  const mismatch =
    SPEC_COLUMNS.some((k) => !eq(order[k], rev[k])) ||
    !eq(order.furniture_price, rev.quoted_furniture_price) ||
    !eq(order.delivery_fee, rev.quoted_delivery_fee);
  if (mismatch) {
    throw new DomainError("SPEC_SNAPSHOT_MISMATCH", "The order's specification differs from the approved revision.");
  }
}

/** Quotation validity in days (QUOTE_VALIDITY_DAYS, default 7, clamped 1–90 like the database). */
export function quoteValidityDays(): number {
  const n = Number(process.env.QUOTE_VALIDITY_DAYS ?? 7);
  return Number.isFinite(n) ? Math.min(90, Math.max(1, Math.round(n))) : 7;
}

export function isQuoteExpired(rev: Pick<SpecRevision, "expires_at">, at: Date = new Date()): boolean {
  return !!rev.expires_at && at.getTime() > new Date(rev.expires_at).getTime();
}
