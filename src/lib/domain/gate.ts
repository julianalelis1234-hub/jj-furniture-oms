import { DomainError } from "./errors";
import type { Order, OrderException, SpecRevision } from "./types";

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

/**
 * The 6-condition production unlock gate — identical to private.orders_before_write()
 * in migration 003. Called whenever an order moves into Confirmed or In Production.
 *  1+2. the customer explicitly confirmed the LATEST revision (its quote included)
 *  3.   that revision is a shop quote, not an unreviewed customer proposal
 *  4.   no Pending review items remain for the order
 *  5.   valid preceding status (checked by the state machine)
 *  6.   the order's spec + quote equal the approved revision snapshot
 */
export function assertProductionGate(order: Order, revisions: SpecRevision[], exceptions: OrderException[]): void {
  if (!order.specs_confirmed) {
    throw new DomainError("SPECS_NOT_CONFIRMED", "The customer must confirm the specifications before production can start.");
  }
  if (order.approved_revision_number == null || order.approved_revision_number !== order.current_revision) {
    throw new DomainError("STALE_REVISION", "The confirmed revision is not the latest specification. Ask the customer to confirm the latest revision.");
  }
  const rev = revisions.find((r) => r.order_id === order.id && r.revision_number === order.approved_revision_number);
  if (!rev || rev.revision_type === "customer_proposal") {
    throw new DomainError("PENDING_REVIEW", "The approved revision has not been quoted by the shop yet.");
  }
  if (exceptions.some((e) => e.order_id === order.id && e.status === "Pending")) {
    throw new DomainError("PENDING_REVIEW", "Resolve the open review items for this order first.");
  }
  const mismatch =
    SPEC_COLUMNS.some((k) => !eq(order[k], rev[k])) ||
    !eq(order.furniture_price, rev.quoted_furniture_price) ||
    !eq(order.delivery_fee, rev.quoted_delivery_fee);
  if (mismatch) {
    throw new DomainError("SPEC_SNAPSHOT_MISMATCH", "The order's specification differs from the approved revision.");
  }
}
