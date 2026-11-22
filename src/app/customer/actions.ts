"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { requestSetupLink, SETUP_LINK_GENERIC } from "@/lib/email/requests";
import { clientIp } from "@/lib/server/request-meta";
import { ZodError } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/config";
import type { DataStore } from "@/lib/data/store";
import type { MemoryStore } from "@/lib/data/memory-store";
import { demoCustomerLogin } from "@/lib/data/seed";
import { DomainError } from "@/lib/domain/errors";
import { customerLoginSchema, firstErrors } from "@/lib/domain/validation";
import { getPublicStore } from "@/lib/server/context";
import {
  customerSetPassword,
  customerSignIn,
  customerSignOut,
  getCustomer,
  getCustomerAuth,
  getCustomerStore,
  getReviewSession,
  setReviewSession,
} from "@/lib/server/customer-auth";
import { acceptFromReview, customerOwnedRequest, openReviewLink, proposeFromReview, type ProvisionResult } from "@/lib/services/customer-portal";

function fail(e: unknown): { ok: false; message: string; code?: string; fieldErrors?: Record<string, string> } {
  if (e instanceof DomainError) {
    return { ok: false, message: e.message, code: e.code, fieldErrors: e.details instanceof ZodError ? firstErrors(e.details) : undefined };
  }
  console.error("[customer action]", e);
  return { ok: false, message: "Something went wrong on the server. Please try again." };
}

/**
 * Consumes the single-use review link (POST from /customer/review, so email
 * scanners that merely fetch the link cannot use it up) and opens a review
 * session limited to ONE order + ONE quotation revision.
 */
export async function openReviewAction(token: string): Promise<ActionResult> {
  try {
    const scope = await openReviewLink(await getPublicStore(), token);
    await setReviewSession(scope);
  } catch (e) {
    return fail(e);
  }
  redirect("/customer/review/quote");
}

/** [Accept Quote & Confirm Specifications] within the review session; provisioning follows and can never undo it. */
export async function reviewAcceptAction(input: {
  accepted_furniture_price: number;
  accepted_delivery_fee: number;
  client_idempotency_key: string;
  accept_specification: boolean;
  accept_quotation: boolean;
}): Promise<ActionResult<ProvisionResult & { demo_setup_path?: string }>> {
  const scope = await getReviewSession();
  if (!scope) return { ok: false, message: "Your review session ended. Open the link from your email again, or ask the shop for a new one." };
  try {
    const store = await getPublicStore();
    const { order, provisioning } = await acceptFromReview(store, await getCustomerAuth(), scope, input);
    return { ok: true, data: { ...provisioning, demo_setup_path: await demoSetupPath(store, order.customer_email) }, message: "Thank you! You accepted the specifications and the quotation." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * DEMO MODE ONLY: the password set-up link that was just "emailed" (it sits in the
 * in-memory Demo Inbox), so a tester can go straight from accepting to creating a
 * password. In production this returns nothing: the link travels by email only,
 * because receiving it is what proves the customer owns the address.
 */
async function demoSetupPath(store: DataStore, email: string | null): Promise<string | undefined> {
  if (!isDemoMode() || !email || store.kind !== "memory") return undefined;
  const mail = (store as MemoryStore).t.demo_mailbox.find((m) => m.to === email && m.text.includes("/customer/set-password?token="));
  const m = mail?.text.match(/\/customer\/set-password\?token=[A-Za-z0-9_-]+/);
  return m?.[0];
}

/** Submit Specification Changes for Review — limited to the review session's order. */
export async function reviewProposeAction(fd: FormData): Promise<ActionResult<{ revision_number: number }>> {
  const scope = await getReviewSession();
  if (!scope) return { ok: false, message: "Your review session ended. Open the link from your email again, or ask the shop for a new one." };
  try {
    const r = await proposeFromReview(await getPublicStore(), scope, Object.fromEntries(fd));
    return { ok: true, data: { revision_number: r.revision_number }, message: "Your changes were sent to JJ Furniture. They will email you a revised quotation." };
  } catch (e) {
    return fail(e);
  }
}

export async function customerLoginAction(_: unknown, fd: FormData): Promise<ActionResult> {
  const parsed = customerLoginSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, message: "Enter your email and password.", fieldErrors: firstErrors(parsed.error) };
  try {
    await customerSignIn(parsed.data.email, parsed.data.password);
  } catch (e) {
    return fail(e);
  }
  redirect("/customer/orders");
}

/**
 * [Demo Customer Login (Maria Santos)] — Demo Mode ONLY. Refused on the server
 * in production regardless of what the browser sends (the button is not even
 * rendered there). Signs in the fictional seeded account through the normal
 * password check, so it gets exactly the same session as a typed login.
 */
export async function demoCustomerLoginAction(): Promise<ActionResult> {
  if (!isDemoMode()) return { ok: false, code: "FORBIDDEN", message: "Demo login is not available." };
  try {
    const demo = demoCustomerLogin();
    await customerSignIn(demo.email, demo.password);
  } catch (e) {
    return fail(e);
  }
  redirect("/customer/orders");
}

/** Request Post-Confirmation Change / Repair — signed-in customers, for their OWN orders only. */
export async function customerOrderRequestAction(orderCode: string, kind: "change" | "repair", fd: FormData): Promise<ActionResult> {
  const customer = await getCustomer();
  if (!customer) return { ok: false, code: "UNAUTHENTICATED", message: "Please log in again." };
  try {
    await customerOwnedRequest(await getCustomerStore(), customer.id, orderCode, String(fd.get("description") ?? ""), kind);
  } catch (e) {
    return fail(e);
  }
  return { ok: true, message: kind === "change" ? "Change request sent. The shop will review it and contact you." : "Request sent. The shop will contact you to schedule the touch-up." };
}

/** "Forgot Password?" — same service, limits and generic answer as POST /api/auth/request-setup-link. */
export async function customerForgotAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const r = await requestSetupLink(await getPublicStore(), await getCustomerAuth(), { email: fd.get("email"), clientIp: await clientIp() }, (task) => after(task));
    return { ok: r.status === 200, message: r.message };
  } catch {
    return { ok: true, message: SETUP_LINK_GENERIC };
  }
}

export async function customerSetPasswordAction(token: string | null, _: unknown, fd: FormData): Promise<ActionResult> {
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { ok: false, message: "The two passwords do not match.", fieldErrors: { confirm: "The two passwords do not match." } };
  try {
    await customerSetPassword(token, password);
  } catch (e) {
    return fail(e);
  }
  redirect("/customer/orders?welcome=1");
}

export async function customerLogoutAction() {
  await customerSignOut();
  redirect("/customer/login");
}
