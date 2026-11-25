"use server";

import { getRoomPhotoStore } from "@/lib/server/proof-store";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { isDemoMode } from "@/lib/config";
import type { ActionResult } from "@/lib/action-result";
import { DEMO_ACCOUNT_PASSWORD, DEMO_PERSONA, demoAccounts, demoCustomerLogin } from "@/lib/data/seed";
import { DomainError } from "@/lib/domain/errors";
import type { Actor, ConfirmationMethod, OrderStatus, PaymentExceptionType, PriorityLabel, Role } from "@/lib/domain/types";
import { ROLES } from "@/lib/domain/types";
import { firstErrors } from "@/lib/domain/validation";
import { authorize, DEMO_COOKIE, demoSwitcherAllowed, getPublicStore, getStore, PORTAL_FOR, setDemoSession } from "@/lib/server/context";
import { resetMemoryStore } from "@/lib/server/memory";
import { withActorRole } from "@/lib/realtime/actor-context";
import { createUserClient } from "@/lib/server/supabase";
import { resendForOrder } from "@/lib/email/requests";
import { customerSignIn, customerSignOut, getCustomer, getCustomerAuth } from "@/lib/server/customer-auth";
import { createCustomerRequest } from "@/lib/services/customer";
import { scheduleDelivery } from "@/lib/services/deliveries";
import { decideException, requestException, reviewCustomerProposal } from "@/lib/services/exceptions";
import { retryNotification, SMS_SIMULATED_NOTE, smsMode } from "@/lib/services/notify";
import { addLumberItem, recordLumberMovement, setReorderLevel } from "@/lib/services/inventory";
import {
  assignCraftsman,
  confirmOrder,
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
import { logPayment, rejectPayment, verifyCashHandover, verifyPayment } from "@/lib/services/payments";


/** Uniform wrapper: server-side authorization, domain errors -> friendly results, UI refresh. */
async function run<T>(roles: Role[] | null, fn: (actor: Actor) => Promise<T>, message?: string | ((data: T) => string)): Promise<ActionResult<T>> {
  try {
    const actor = roles ? await authorize(roles) : (null as unknown as Actor);
    const data = await withActorRole(actor?.role ?? "system", () => fn(actor));
    refresh();
    return { ok: true, message: typeof message === "function" ? message(data) : message, data };
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
/** Role-switcher bar (Demo account only): jump to another staff portal as its demo persona. */
export async function switchDemoRole(role: Role) {
  if (!isDemoMode()) throw new Error("Role switching is disabled in production mode.");
  if (!(await demoSwitcherAllowed())) throw new Error("Only the Demo account can switch roles. Sign in with that account first.");
  if (!ROLES.includes(role)) throw new Error("Unknown role");
  await setDemoSession(DEMO_PERSONA[role], true);
  redirect(PORTAL_FOR[role]);
}

/** Role-switcher bar (Demo account only): open the customer portal as the demo customer. */
export async function switchDemoToCustomer() {
  if (!isDemoMode() || !(await demoSwitcherAllowed())) throw new Error("Only the Demo account can switch roles.");
  // keep a customer who is already signed in (e.g. one who just created a password); else the demo customer
  if (!(await getCustomer())) await customerSignIn(demoCustomerLogin().email, DEMO_ACCOUNT_PASSWORD);
  redirect("/customer/orders");
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

/**
 * One sign-in for every account.
 *  - Demo Mode: the six fixed demo accounts (shared demo password). The Demo account gets the
 *    role-switcher bar; fixed role accounts only see their own portal; the customer opens /customer/orders.
 *  - Live: Supabase Auth. Staff go to their portal; a customer account goes to its orders.
 */
export async function signIn(_: unknown, fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email").trim().toLowerCase();
  const password = str(fd, "password");
  if (isDemoMode()) {
    const acct = demoAccounts().find((a) => a.email === email);
    if (!acct || password !== DEMO_ACCOUNT_PASSWORD) return { ok: false, message: "Wrong email or password." };
    (await cookies()).delete(DEMO_COOKIE);
    await customerSignOut();
    if (acct.key === "customer") {
      await customerSignIn(acct.email, password);
      redirect("/customer/orders");
    }
    await setDemoSession(acct.profileId!, !!acct.all);
    const role = (await (await getStore()).listProfiles()).find((p) => p.id === acct.profileId)!.role;
    redirect(PORTAL_FOR[role]);
  }
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Only real credential errors say "wrong password"; outages must not look like a typo.
    if (error.status === 400 || /invalid login credentials/i.test(error.message)) return { ok: false, message: "Wrong email or password." };
    console.error("[signIn]", error.status, error.message);
    return { ok: false, message: "Cannot reach the sign-in service right now. Check the connection and try again." };
  }
  const { data } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", data.user!.id).maybeSingle();
  if (profile?.role === "customer" && profile.is_active) redirect("/customer/orders");
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { ok: false, message: "This account has no active staff profile. Ask the owner to activate it." };
  }
  redirect(PORTAL_FOR[profile.role as Role]);
}

export async function signOut() {
  if (isDemoMode()) {
    (await cookies()).delete(DEMO_COOKIE);
    await customerSignOut(); // the Demo account may also hold the demo customer's session
  } else await (await createUserClient()).auth.signOut();
  redirect("/");
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
  return run(["owner", "staff"], async (a) => {
    const r = await resendForOrder(await getStore(), await getCustomerAuth(), a, orderId, "quote_review");
    return { status: r.delivery };
  }, (d) => d.status === "sent" ? "A new single-use review link was emailed to the customer."
    : d.status === "failed" ? "A new review link was issued, but the email provider rejected it — check the customer's email address."
    : "A new review link is queued; it will be emailed as soon as the email provider accepts it.");
}

/** Staff: retry the post-acceptance account set-up (idempotent; never touches the acceptance). */
export async function retryProvisioningAction(orderId: string) {
  return run(["owner", "staff"], async (a) => {
    const r = await resendForOrder(await getStore(), await getCustomerAuth(), a, orderId, "account_setup");
    return { status: r.provisioning, delivery: r.delivery };
  }, "Account set-up re-checked.");
}

/** Staff record an in-store / Messenger acceptance of the exact revision + quotation shown. */
/** Staff record the customer's acceptance of the issued quotation (e.g. signed at the shop) with the chosen terms. */
export async function recordConfirmationAction(input: AcceptanceInput & { confirmation_method: ConfirmationMethod }) {
  return run(["owner", "staff"], async (a) => { await recordConfirmation(await getStore(), a, input); },
    `Quotation (revision ${input.revision_number}) accepted. Production starts once the down payment is verified.`);
}

/** Waiting for Confirmation -> Confirmed, then the customer's "create your password" / "log in" email. */
export async function confirmOrderAction(orderId: string, expectedVersion?: number) {
  return run(["owner", "staff"], async (a) => (await confirmOrder(await getStore(), a, await getCustomerAuth(), orderId, expectedVersion)).provisioning,
    (p) => p.status === "not_applicable"
      ? "Order confirmed. Walk-in order: tell the customer the quotation at the shop."
      : p.status === "failed"
        ? `Order confirmed, but the customer email was not sent: ${p.detail ?? "check the email address"}.`
        : p.new_account ? "Order confirmed. The customer was emailed a link to create their password." : "Order confirmed. The customer was emailed to log in.");
}

/** Saves a shop revision. For a Confirmed order this IS the issued quotation (payment email follows). */
export async function reviseSpecsAction(orderId: string, expectedRevision: number | null, fd: FormData) {
  let issued = false;
  return run(["owner", "staff"], async (a) => { issued = (await reviseSpecs(await getStore(), a, orderId, Object.fromEntries(fd), expectedRevision)).status === "Confirmed"; },
    () => issued
      ? "Quotation issued. The customer was emailed to accept it and choose how to pay."
      : "Draft quote saved. Confirm the order, then issue the quotation.");
}

/** Verify a customer-submitted (or driver cash) payment: only verified payments count toward the 30% gate. */
export async function verifyPaymentAction(paymentId: string) {
  return run(["owner", "staff"], async (a) => { await verifyPayment(await getStore(), a, paymentId); }, "Payment verified.");
}

export async function rejectPaymentAction(paymentId: string, reason: string) {
  return run(["owner", "staff"], async (a) => { await rejectPayment(await getStore(), a, paymentId, reason); }, "Payment rejected. The customer was told why.");
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
/** The order slip shown (and printable) right after an online submission: no prices, no secrets. */
export type OrderSlip = {
  order_code: string; email: string; customer_name: string; customer_phone: string; delivery_address: string; municipality: string;
  item: string; size: string; wood: string; finish: string; quantity: number; notes: string | null; submitted_at: string;
};

export async function customerRequestAction(_: unknown, fd: FormData): Promise<ActionResult<OrderSlip>> {
  return run(null, async () => {
    const photo = fd.get("room_photo");
    fd.delete("room_photo");
    const roomPhoto = photo instanceof File && photo.size > 0
      ? { file: { bytes: new Uint8Array(await photo.arrayBuffer()), type: photo.type, size: photo.size }, store: getRoomPhotoStore() }
      : null;
    const { order: o } = await createCustomerRequest(await getPublicStore(), Object.fromEntries(fd), roomPhoto);
    return {
      order_code: o.order_code, email: o.customer_email ?? "", customer_name: o.customer_name, customer_phone: o.customer_phone,
      delivery_address: o.delivery_address, municipality: o.municipality, item: o.item_name, size: o.dimensions,
      wood: o.wood_type === "Other" && o.custom_wood_note ? o.custom_wood_note : o.wood_type, finish: o.color_finish, quantity: o.quantity,
      notes: o.special_instructions, submitted_at: o.created_at,
    };
  }, "Order sent. Keep your order slip.");
}

// ------------------------------------------------------- owner: craftsmen + inventory
export async function assignCraftsmanAction(orderId: string, craftsmanId: string | null) {
  return run(["owner", "staff"], async (a) => { await assignCraftsman(await getStore(), a, orderId, craftsmanId || null); },
    craftsmanId ? "Craftsman assigned." : "Craftsman unassigned.");
}

export async function addLumberItemAction(_: unknown, fd: FormData) {
  return run(["owner"], async (a) => { await addLumberItem(await getStore(), a, Object.fromEntries(fd)); }, "Lumber item added. Record its opening stock as a receive.");
}

export async function setReorderLevelAction(itemId: string, level: number) {
  return run(["owner"], async (a) => { await setReorderLevel(await getStore(), a, itemId, level); }, "Reorder level saved.");
}

export async function recordLumberAction(_: unknown, fd: FormData) {
  return run(["owner", "staff"], async (a) => (await recordLumberMovement(await getStore(), a, Object.fromEntries(fd))).movement,
    (m) => `${m.kind === "receive" ? "Received" : m.kind === "use" ? "Used" : "Adjusted"} ${Math.abs(m.board_feet).toLocaleString("en-PH")} board feet.`);
}
