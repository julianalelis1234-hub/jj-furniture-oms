"use server";

import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { isDemoMode } from "@/lib/config";
import type { ActionResult } from "@/lib/action-result";
import { DEMO_PERSONA, SEED_PROFILES } from "@/lib/data/seed";
import { DomainError } from "@/lib/domain/errors";
import type { Actor, ConfirmationMethod, OrderStatus, PaymentExceptionType, PriorityLabel, Role } from "@/lib/domain/types";
import { ROLES } from "@/lib/domain/types";
import { firstErrors, pinSchema } from "@/lib/domain/validation";
import { authorize, DEMO_COOKIE, getPublicStore, getStore, PORTAL_FOR, setDemoSession } from "@/lib/server/context";
import { resetMemoryStore } from "@/lib/server/memory";
import { createUserClient } from "@/lib/server/supabase";
import { signToken } from "@/lib/server/token";
import { CUSTOMER_COOKIE, getVerifiedCustomerOrderId } from "@/lib/server/customer-session";
import { customerConfirmSpecs, customerRequestRepair, trackOrder } from "@/lib/services/customer";
import { scheduleDelivery } from "@/lib/services/deliveries";
import { decideException, requestException } from "@/lib/services/exceptions";
import { retryNotification } from "@/lib/services/notify";
import {
  createOrder,
  editOrderDetails,
  failInspection,
  moveInQueue,
  passInspection,
  recordConfirmation,
  reviseSpecs,
  setPaymentTerms,
  setPriorityLabel,
  transitionOrder,
} from "@/lib/services/orders";
import { logPayment, verifyCashHandover } from "@/lib/services/payments";


/** Uniform wrapper: server-side authorization, domain errors -> friendly results, UI refresh. */
async function run<T>(roles: Role[] | null, fn: (actor: Actor) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const actor = roles ? await authorize(roles) : (null as unknown as Actor);
    const data = await fn(actor);
    refresh();
    return { ok: true, message, data };
  } catch (e) {
    if (e instanceof DomainError) {
      const fieldErrors = e.details instanceof ZodError ? firstErrors(e.details) : undefined;
      return { ok: false, message: e.message, code: e.code, fieldErrors };
    }
    console.error("[action]", e);
    return { ok: false, message: "Something went wrong on the server. Nothing was saved — please try again." };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

// --------------------------------------------------------------- session --
export async function switchDemoRole(role: Role) {
  if (!isDemoMode()) throw new Error("Role switching is disabled in production mode.");
  if (!ROLES.includes(role)) throw new Error("Unknown role");
  await setDemoSession(DEMO_PERSONA[role]);
  redirect(PORTAL_FOR[role]);
}

export async function switchDemoPersona(profileId: string) {
  if (!isDemoMode()) throw new Error("Role switching is disabled in production mode.");
  const p = SEED_PROFILES.find((x) => x.id === profileId);
  if (!p) throw new Error("Unknown persona");
  await setDemoSession(p.id);
  redirect(PORTAL_FOR[p.role]);
}

export async function resetDemoData(): Promise<ActionResult> {
  if (!isDemoMode()) return { ok: false, message: "Reset is only available in demo mode." };
  const store = await getStore();
  if (store.kind !== "memory") {
    return { ok: false, message: "This demo uses a Supabase project. Reset it with `npm run db:seed` (see README)." };
  }
  await resetMemoryStore();
  refresh();
  return { ok: true, message: "Demo data restored to the Valencia City sample set." };
}

export async function signIn(_: unknown, fd: FormData): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, message: "Demo mode uses the role switcher." };
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({ email: str(fd, "email").trim(), password: str(fd, "password") });
  if (error) return { ok: false, message: "Wrong email or password." };
  const { data } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", data.user!.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { ok: false, message: "This account has no active staff profile. Ask the owner to activate it." };
  }
  redirect(PORTAL_FOR[profile.role as Role]);
}

export async function signOut() {
  if (isDemoMode()) (await cookies()).delete(DEMO_COOKIE);
  else await (await createUserClient()).auth.signOut();
  redirect(isDemoMode() ? "/" : "/login");
}

// ---------------------------------------------------------------- orders --
export async function createOrderAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string; order_code: string; pin: string }>> {
  return run(["owner", "staff"], async (actor) => {
    const { order, pin } = await createOrder(await getStore(), actor, Object.fromEntries(fd));
    return { id: order.id, order_code: order.order_code, pin };
  }, "Order saved. Print the confirmation slip for the customer.");
}

export async function recordConfirmationAction(input: { order_id: string; confirmation_method: ConfirmationMethod; confirmed_by_name: string }) {
  return run(["owner", "staff"], async (a) => { await recordConfirmation(await getStore(), a, input); }, "Specifications confirmed. The order can now enter production.");
}

export async function reviseSpecsAction(orderId: string, fd: FormData) {
  return run(["owner", "staff"], async (a) => { await reviseSpecs(await getStore(), a, orderId, Object.fromEntries(fd)); }, "Specs revised. Ask the customer to confirm again.");
}

export async function editOrderAction(orderId: string, fd: FormData) {
  return run(["owner", "staff"], async (a) => { await editOrderDetails(await getStore(), a, orderId, Object.fromEntries(fd)); }, "Order details updated.");
}

export async function setPaymentTermsAction(orderId: string, type: PaymentExceptionType) {
  return run(["owner", "staff"], async (a) => { await setPaymentTerms(await getStore(), a, orderId, type); }, "Payment terms updated.");
}

export async function transitionAction(orderId: string, to: OrderStatus, expectedVersion: number, notes?: string) {
  return run(["owner", "staff", "craftsman"], async (a) => {
    await transitionOrder(await getStore(), a, orderId, to, { expectedVersion, notes });
  }, `Moved to “${to}”.`);
}

export async function inspectionAction(orderId: string, pass: boolean, notes: string) {
  return run(["owner"], async (a) => {
    const store = await getStore();
    if (pass) await passInspection(store, a, orderId, notes);
    else await failInspection(store, a, orderId, notes);
  }, pass ? "Inspection passed — ready for delivery." : "Sent back to the workshop for revision.");
}

export async function moveQueueAction(orderId: string, direction: "up" | "down") {
  return run(["owner"], async (a) => { await moveInQueue(await getStore(), a, orderId, direction); });
}

export async function setPriorityAction(orderId: string, label: PriorityLabel) {
  return run(["owner"], async (a) => { await setPriorityLabel(await getStore(), a, orderId, label); }, `Priority set to ${label}.`);
}

// -------------------------------------------------------------- payments --
export async function logPaymentAction(_: unknown, fd: FormData) {
  return run(["owner", "staff"], async (a) => {
    const r = await logPayment(await getStore(), a, Object.fromEntries(fd));
    return { duplicate: r.duplicate };
  }, "Payment recorded.");
}

export async function verifyHandoverAction(paymentId: string) {
  return run(["owner", "staff"], async (a) => { await verifyCashHandover(await getStore(), a, paymentId); }, "Cash handover verified.");
}

// ------------------------------------------------------------ deliveries --
export async function scheduleDeliveryAction(_: unknown, fd: FormData) {
  return run(["owner", "staff"], async (a) => { await scheduleDelivery(await getStore(), a, Object.fromEntries(fd)); }, "Delivery scheduled and customer notified.");
}

// ------------------------------------------------------------ exceptions --
export async function requestExceptionAction(input: { order_id: string; category: string; description: string }) {
  return run(["owner", "staff", "craftsman", "driver"], async (a) => { await requestException(await getStore(), a, input); }, "Sent to the office.");
}

export async function decideExceptionAction(id: string, decision: "Approved" | "Rejected" | "Resolved", note?: string) {
  return run(["owner", "staff"], async (a) => { await decideException(await getStore(), a, id, decision, note); }, `Marked ${decision.toLowerCase()}.`);
}

export async function retrySmsAction(id: string, phone?: string) {
  return run(["owner", "staff"], async () => {
    const n = await retryNotification(await getStore(), id, phone);
    if (n.delivery_status === "Failed") throw new DomainError("BACKEND", "SMS failed again: number not reachable. Try another number or Messenger.");
    return n.delivery_status;
  }, "SMS re-sent.");
}

// -------------------------------------------------------------- customer --
async function clientKey() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "local").trim();
}

export async function customerLookupAction(_: unknown, fd: FormData) {
  const code = str(fd, "order_code").trim().toUpperCase();
  const pin = str(fd, "pin").trim();
  try {
    const store = await getPublicStore();
    if (!pin) {
      const track = await trackOrder(store, code);
      if (!track) return { ok: false as const, message: "No order found with that Order ID. Check your receipt (e.g. JJ-2026-0145)." };
      return { ok: true as const, data: { mode: "track" as const, track } };
    }
    const parsed = pinSchema.safeParse({ order_code: code, pin });
    if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0].message };
    const r = await store.customerVerifyPin(parsed.data.order_code, parsed.data.pin, await clientKey());
    if (r.locked) return { ok: false as const, message: "Too many wrong PINs. Please wait 15 minutes or call the shop." };
    if (!r.ok || !r.order_id)
      return { ok: false as const, message: `Order ID and PIN do not match. ${r.remaining_attempts ?? 0} tries left.` };
    (await cookies()).set(CUSTOMER_COOKIE, signToken({ oid: r.order_id }, 60 * 60), {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/track", maxAge: 60 * 60,
    });
    redirect("/track/order");
  } catch (e) {
    if (e instanceof DomainError) return { ok: false as const, message: e.message };
    throw e; // includes the redirect signal
  }
}

export async function customerConfirmAction() {
  const oid = await getVerifiedCustomerOrderId();
  if (!oid) return { ok: false as const, message: "Your session expired. Enter your Order ID and PIN again." };
  return run(null, async () => { await customerConfirmSpecs(await getPublicStore(), oid); }, "Thank you! Your specifications are confirmed.");
}

export async function customerRepairAction(description: string) {
  const oid = await getVerifiedCustomerOrderId();
  if (!oid) return { ok: false as const, message: "Your session expired. Enter your Order ID and PIN again." };
  return run(null, async () => { await customerRequestRepair(await getPublicStore(), oid, description); }, "Request sent. The shop will contact you to schedule the touch-up.");
}

export async function customerSignOut() {
  (await cookies()).delete({ name: CUSTOMER_COOKIE, path: "/track" });
  redirect("/track");
}
