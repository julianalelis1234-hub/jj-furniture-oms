import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import type { Actor, ExceptionCategory, OrderException } from "@/lib/domain/types";
import { exceptionRequestSchema } from "@/lib/domain/validation";
import { ensureRole } from "./guard";
import { mustGetOrder } from "./orders";

const FINANCIAL: ExceptionCategory[] = ["Installment Approval", "Credit / Unpaid Balance", "Special Delivery Terms"];

export async function requestException(store: DataStore, actor: Actor, raw: unknown) {
  const parsed = exceptionRequestSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please describe the request.", parsed.error);
  const v = parsed.data;
  if (actor.role === "craftsman" && v.category !== "Spec Clarification")
    throw new DomainError("FORBIDDEN", "Craftsmen can only ask specification questions.");
  if (actor.role === "driver") {
    if (v.category !== "On-Site Scratch Touch-Up / Repair") throw new DomainError("FORBIDDEN", "Drivers can only report touch-ups.");
    const mine = (await store.listDeliveries({ driverId: actor.id })).some((d) => d.order_id === v.order_id);
    if (!mine) throw new DomainError("FORBIDDEN", "This order is not assigned to you.");
  }
  // Craftsmen cannot read the orders table; existence is checked through the workshop view.
  if (actor.role === "craftsman") {
    if (!(await store.listWorkshopOrders()).some((o) => o.id === v.order_id)) throw new DomainError("NOT_FOUND", "Order not found.");
  } else {
    await mustGetOrder(store, v.order_id);
  }
  return store.insertException({
    order_id: v.order_id,
    category: v.category,
    description: v.description,
    requested_by: actor.full_name,
    status: "Pending",
    resolved_by_id: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  });
}

export async function decideException(
  store: DataStore,
  actor: Actor,
  id: string,
  decision: "Approved" | "Rejected" | "Resolved",
  note?: string,
): Promise<OrderException> {
  ensureRole(actor, ["owner", "staff"], "resolve exceptions");
  const ex = (await store.listExceptions()).find((e) => e.id === id);
  if (!ex) throw new DomainError("NOT_FOUND", "Request not found.");
  if (ex.status !== "Pending") throw new DomainError("VALIDATION", `This request is already ${ex.status}.`);
  if (FINANCIAL.includes(ex.category) && decision !== "Resolved" && actor.role !== "owner")
    throw new DomainError("OWNER_ONLY", "Only the owner can approve or reject payment and delivery exceptions.");
  if (ex.category === "Spec Clarification" && !note?.trim())
    throw new DomainError("VALIDATION", "Write the answer for the craftsman.");

  const order = await mustGetOrder(store, ex.order_id);
  if (ex.category === "Spec Clarification") {
    const answer = `Clarified (${actor.full_name}): ${note!.trim()}`;
    const res = await store.updateOrder(order.id, {
      special_instructions: [order.special_instructions, answer].filter(Boolean).join("\n"),
    });
    if (!res.ok) throw new DomainError("VERSION_CONFLICT", "Order changed. Please refresh.");
  }
  if ((ex.category === "Installment Approval" || ex.category === "Credit / Unpaid Balance") && decision === "Approved") {
    const res = await store.updateOrder(order.id, {
      payment_exception_approved: true,
      payment_exception_type: order.payment_exception_type === "Standard 30/70" ? "Credit / Pay Later" : order.payment_exception_type,
    });
    if (!res.ok) throw new DomainError("VERSION_CONFLICT", "Order changed. Please refresh.");
  }
  return store.updateException(id, {
    status: decision,
    resolved_by_id: actor.id,
    resolved_at: new Date().toISOString(),
    description: note?.trim() && ex.category !== "Spec Clarification" ? `${ex.description}\n— ${actor.full_name}: ${note.trim()}` : ex.description,
  });
}
