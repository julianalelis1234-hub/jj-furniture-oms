"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { isDemoMode } from "@/lib/config";
import type { ActionResult } from "@/lib/action-result";
import { DEMO_PERSONA, SEED_PROFILES } from "@/lib/data/seed";
import { DomainError } from "@/lib/domain/errors";
import type { Actor, ConfirmationMethod, OrderStatus, PaymentExceptionType, PriorityLabel, Role } from "@/lib/domain/types";
import { ROLES } from "@/lib/domain/types";
import { firstErrors } from "@/lib/domain/validation";
import { authorize, DEMO_COOKIE, getPublicStore, getStore, PORTAL_FOR, setDemoSession } from "@/lib/server/context";
import { resetMemoryStore } from "@/lib/server/memory";
import { createUserClient } from "@/lib/server/supabase";
import { issueReviewLink, provisionCustomerAccount } from "@/lib/services/customer-portal";
import { getCustomerAuth } from "@/lib/server/customer-auth";
import { createCustomerRequest } from "@/lib/services/customer";
import { scheduleDelivery } from "@/lib/services/deliveries";
import { decideException, requestException, reviewCustomerProposal } from "@/lib/services/exceptions";
import { retryNotification, SMS_SIMULATED_NOTE, smsMode } from "@/lib/services/notify";
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
  startProduction,
  transitionOrder,
  type AcceptanceInput,
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
  if (error) {
    // Only real credential errors say "wrong password"; outages must not look like a typo.
    if (error.status === 400 || /invalid login credentials/i.test(error.message)) return { ok: false, message: "Wrong email or password." };
    console.error("[signIn]", error.status, error.message);
    return { ok: false, message: "Cannot reach the sign-in service right now. Check the connection and try again." };
  }
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
export async function createOrderAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string; order_code: string }>> {
  return run(["owner", "staff"], async (actor) => {
    const { order } = await createOrder(await getStore(), actor, Object.fromEntries(fd));
    return { id: order.id, order_code: order.order_code };
  }, "Order saved. Print the paper slip for the customer.");
}

/** Staff: send a fresh single-use review link for the current quotation (older links stop working). */
export async function resendReviewLinkAction(orderId: string) {
  return run(["owner", "staff"], async () => {
    const r = await issueReviewLink(await getStore(), orderId);
    return { status: r.status };
  }, "A new review link was issued to the customer's email.");
}

/** Staff: retry the post-acceptance account set-up (idempotent; never touches the acceptance). */
export async function retryProvisioningAction(orderId: string) {
  return run(["owner", "staff"], async () => {
    const r = await provisionCustomerAccount(await getStore(), await getCustomerAuth(), orderId);
    return { status: r.status, detail: r.detail };
  }, "Account set-up re-checked.");
}

/** Staff record an in-store / Messenger acceptance of the exact revision + quotation shown. */
export async function recordConfirmationAction(input: AcceptanceInput & { confirmation_method: ConfirmationMethod }) {
  return run(["owner", "staff"], async (a) => { await recordConfirmation(await getStore(), a, input); },
    `Specification + quotation of revision ${input.revision_number} accepted. Production starts once the 30% down payment is verified.`);
}

/** Issues a quotation (first quote for a customer request, or a revised quote). */
export async function reviseSpecsAction(orderId: string, expectedRevision: number | null, fd: FormData) {
  return run(["owner", "staff"], async (a) => { await reviseSpecs(await getStore(), a, orderId, Object.fromEntries(fd), expectedRevision); },
    "Quotation saved as a new revision. The customer must accept it before it expires.");
}

/** Confirmed -> In Production after the server-side 30% / approval / drift / blocking checks. */
export async function startProductionAction(orderId: string, craftsmanId: string | null) {
  return run(["owner", "staff"], async (a) => { await startProduction(await getStore(), a, orderId, craftsmanId || null); },
    "Released to the workshop. The specification is now locked for production.");
}

export async function reviewProposalAction(exceptionId: string, decision: "quote" | "decline", fd: FormData) {
  return run(["owner", "staff"], async (a) => {
    await reviewCustomerProposal(await getStore(), a, exceptionId, decision, Object.fromEntries(fd), String(fd.get("note") ?? ""));
  }, decision === "quote" ? "Revised quote sent. The customer must confirm it before production." : "Original specification kept. The customer must confirm it.");
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
  return run(["owner", "staff"], async (a) => { await scheduleDelivery(await getStore(), a, Object.fromEntries(fd)); }, smsMode() === "gateway" ? "Delivery scheduled and customer notified by SMS."
    : smsMode() === "simulated" ? `Delivery scheduled. Customer SMS logged ${SMS_SIMULATED_NOTE}.`
    : "Delivery scheduled. Customer SMS is queued for staff to send manually.");
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
  }, smsMode() === "simulated" ? `SMS re-sent ${SMS_SIMULATED_NOTE}.` : "SMS re-sent.");
}

// -------------------------------------------------------------- customer --
// Customer access is email-based only: /customer/login (account), the single-use
// /customer/review?token= link (one quotation), and this anonymous quote request.
// The retired Order ID + PIN lookup has no action any more (migration 006).

/**
 * Option 2: Customize & Request a Quote — creates a Quote Requested order.
 * No session: the email is unverified until the customer opens the review
 * link that comes with the official quotation.
 */
export async function customerRequestAction(_: unknown, fd: FormData): Promise<ActionResult<{ order_code: string; email: string }>> {
  return run(null, async () => {
    const { order } = await createCustomerRequest(await getPublicStore(), Object.fromEntries(fd));
    return { order_code: order.order_code, email: order.customer_email ?? "" };
  }, "Request sent. Your quotation will be emailed to you.");
}
