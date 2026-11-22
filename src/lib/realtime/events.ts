/**
 * Live-sync change feed (migration 007, public.order_live_events).
 *
 * One minimal, money-free row per change. The DATABASE classifies the
 * transition from committed state; clients only ever notify on that
 * classification. This module mirrors the SQL trigger and RLS policies so the
 * in-memory demo store behaves exactly like Postgres, and so the server can
 * re-check visibility (defense in depth) before answering a client.
 */
import { WORKSHOP_STAGES, type OrderStatus, type Role } from "@/lib/domain/types";

export const LIVE_SOURCES = ["orders", "order_specification_revisions", "order_confirmations", "payments", "delivery_assignments"] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];
export type LiveOp = "INSERT" | "UPDATE" | "DELETE";
export const LIVE_TRANSITIONS = ["quote_requested", "quote_accepted", "stage_progress", "payment_verified"] as const;
export type LiveTransition = (typeof LIVE_TRANSITIONS)[number];
export type LiveViewerRole = Role | "customer";

/** Exactly the columns of public.order_live_events (no amounts, notes, contacts or person ids exist there). */
export interface LiveEvent {
  id: number;
  source: LiveSource;
  op: LiveOp;
  record_id: string;
  order_id: string;
  order_code: string | null;
  status: OrderStatus | null;
  prev_status: OrderStatus | null;
  transition: LiveTransition | null;
  payment_verified: boolean | null;
  actor_role: string;
  order_updated_at: string | null;
  occurred_at: string;
}
export const LIVE_EVENT_COLUMNS =
  "id, source, op, record_id, order_id, order_code, status, prev_status, transition, payment_verified, actor_role, order_updated_at, occurred_at";

export interface LiveViewer {
  role: LiveViewerRole;
  id: string;
}

/** The 7 main stages. "Quote Requested" is intake, never an 8th stage. */
export const MAIN_STAGES = new Set<string>(WORKSHOP_STAGES);
/** Same scope as public.workshop_orders(). */
export const WORKSHOP_SCOPE = new Set<string>(["Confirmed", "In Production", "Completed / For Inspection", "Ready for Delivery"]);
export const DELIVERY_SCOPE = new Set<string>(["Ready for Delivery", "Out for Delivery", "Delivered"]);

/** Mirrors private.emit_order_live_event() for orders rows. */
export function classifyOrderChange(
  op: LiveOp,
  prev: OrderStatus | null,
  next: OrderStatus,
  hasConfirmationForActiveRevision: boolean,
): LiveTransition | null {
  if (op === "INSERT") return next === "Quote Requested" ? "quote_requested" : null;
  if (op !== "UPDATE" || prev === next || prev === null) return null;
  if (prev === "Waiting for Confirmation" && next === "Confirmed" && hasConfirmationForActiveRevision) return "quote_accepted";
  if (MAIN_STAGES.has(prev) && MAIN_STAGES.has(next)) return "stage_progress";
  return null;
}

/** Mirrors the payments branch: only a committed owner/staff verification counts. */
export function classifyPaymentChange(op: LiveOp, wasVerified: boolean | null, isVerified: boolean): LiveTransition | null {
  if (!isVerified) return null;
  return op === "INSERT" || (op === "UPDATE" && !wasVerified) ? "payment_verified" : null;
}

/**
 * Mirrors the RLS policies on order_live_events. `owned` / `assigned` are the
 * viewer's own (customer) or assigned (driver) order ids, read at request time.
 */
export function visibleTo(e: LiveEvent, viewer: LiveViewer, ctx: { owned?: Set<string>; assigned?: Set<string> } = {}): boolean {
  switch (viewer.role) {
    case "owner":
    case "staff":
      return true;
    case "customer":
      return (
        !!ctx.owned?.has(e.order_id) &&
        (e.source === "orders" || e.source === "order_confirmations" || e.source === "payments") &&
        (e.source !== "payments" || e.payment_verified === true)
      );
    case "craftsman":
      return (
        e.source === "orders" &&
        e.transition !== "quote_accepted" &&
        (WORKSHOP_SCOPE.has(e.status ?? "") || WORKSHOP_SCOPE.has(e.prev_status ?? ""))
      );
    case "driver":
      return (
        !!ctx.assigned?.has(e.order_id) &&
        (e.source === "delivery_assignments" ||
          (e.source === "orders" && (DELIVERY_SCOPE.has(e.status ?? "") || DELIVERY_SCOPE.has(e.prev_status ?? ""))))
      );
    default:
      return false;
  }
}
