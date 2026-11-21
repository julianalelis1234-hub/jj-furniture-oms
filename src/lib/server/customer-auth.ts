import "server-only";
import { cookies } from "next/headers";
import { hasSupabase, isDemoMode } from "@/lib/config";
import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import type { CustomerAccount } from "@/lib/domain/types";
import {
  demoCompletePassword,
  demoCustomerAuth,
  demoVerifyPassword,
  passwordProblem,
  type CustomerAuthProvider,
} from "@/lib/services/customer-auth";
import { sendEmail, siteUrl } from "@/lib/services/email";
import { getPublicStore } from "./context";
import { isHttpsRequest } from "./request";
import { createAdminClient, createUserClient } from "./supabase";
import { signToken, verifyToken } from "./token";

/** Demo customer login cookie (production uses the Supabase Auth session cookies). */
export const CUSTOMER_AUTH_COOKIE = "jj_customer_auth";
/** Review session: ONE order + ONE quotation revision, short-lived, http-only. */
export const REVIEW_COOKIE = "jj_review";
const REVIEW_TTL_S = 30 * 60;
const CUSTOMER_TTL_S = 8 * 60 * 60;

const useSupabaseAuth = () => !isDemoMode() && hasSupabase();

// ------------------------------------------------------------ auth provider ----
/** Supabase Auth: users created WITHOUT a password; set-up / reset via one-time recovery links. */
export function supabaseCustomerAuth(store: DataStore): CustomerAuthProvider {
  const admin = createAdminClient();
  if (!admin) throw new DomainError("BACKEND", "Customer accounts need SUPABASE_SERVICE_ROLE_KEY on the server.");
  return {
    async createAccount(email, fullName) {
      // email_confirm: ownership was just proven by opening the emailed review link
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: { portal: "customer" } });
      if (error || !data.user) throw new DomainError("BACKEND", error?.message ?? "Could not create the account.");
      try {
        await store.elevated().insertCustomerProfile({ id: data.user.id, email, full_name: fullName });
      } catch (e) {
        await admin.auth.admin.deleteUser(data.user.id); // keep auth and profiles in step
        throw e;
      }
      return data.user.id;
    },
    async passwordLink(_userId, email) {
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
      const hashed = data?.properties?.hashed_token;
      if (error || !hashed) throw new DomainError("BACKEND", error?.message ?? "Could not create the password link.");
      return `${siteUrl()}/customer/auth/confirm?token_hash=${hashed}&type=recovery&next=/customer/setup-password`;
    },
    async hasPassword(userId) {
      const { data } = await admin.auth.admin.getUserById(userId);
      return !!data.user?.last_sign_in_at;
    },
  };
}

export async function getCustomerAuth(): Promise<CustomerAuthProvider> {
  const store = await getPublicStore();
  return useSupabaseAuth() ? supabaseCustomerAuth(store) : demoCustomerAuth(store);
}

// ------------------------------------------------------------ review session ----
export async function setReviewSession(scope: { order_id: string; revision_id: string }) {
  (await cookies()).set(REVIEW_COOKIE, signToken({ oid: scope.order_id, rid: scope.revision_id }, REVIEW_TTL_S), {
    httpOnly: true, sameSite: "lax", secure: await isHttpsRequest(), path: "/customer/review", maxAge: REVIEW_TTL_S,
  });
}
export async function getReviewSession(): Promise<{ order_id: string; revision_id: string } | null> {
  const d = verifyToken<{ oid: string; rid: string }>((await cookies()).get(REVIEW_COOKIE)?.value);
  return d ? { order_id: d.oid, revision_id: d.rid } : null;
}

// ----------------------------------------------------------- customer session ----
/** The signed-in customer (never a staff member), or null. */
export async function getCustomer(): Promise<CustomerAccount | null> {
  const store = await getPublicStore();
  if (useSupabaseAuth()) {
    const { data } = await (await createUserClient()).auth.getUser();
    if (!data.user) return null;
    const acct = await store.elevated().getCustomerAccount(data.user.id);
    return acct?.is_active ? acct : null;
  }
  const d = verifyToken<{ uid: string }>((await cookies()).get(CUSTOMER_AUTH_COOKIE)?.value);
  if (!d) return null;
  const acct = await store.elevated().getCustomerAccount(d.uid);
  return acct?.is_active ? acct : null;
}

async function setDemoCustomerCookie(uid: string) {
  (await cookies()).set(CUSTOMER_AUTH_COOKIE, signToken({ uid }, CUSTOMER_TTL_S), {
    httpOnly: true, sameSite: "lax", secure: await isHttpsRequest(), path: "/", maxAge: CUSTOMER_TTL_S,
  });
}

const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";

export async function customerSignIn(email: string, password: string) {
  const store = await getPublicStore();
  if (useSupabaseAuth()) {
    const supabase = await createUserClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new DomainError("FORBIDDEN", GENERIC_LOGIN_ERROR);
    const acct = await store.elevated().getCustomerAccount(data.user.id);
    if (!acct?.is_active) {
      await supabase.auth.signOut(); // staff accounts cannot use the customer portal
      throw new DomainError("FORBIDDEN", GENERIC_LOGIN_ERROR);
    }
    return acct;
  }
  const { user_id } = await demoVerifyPassword(store, email, password);
  await setDemoCustomerCookie(user_id);
  return (await store.elevated().getCustomerAccount(user_id))!;
}

export async function customerSignOut() {
  if (useSupabaseAuth()) await (await createUserClient()).auth.signOut();
  (await cookies()).delete({ name: CUSTOMER_AUTH_COOKIE, path: "/" });
}

/** Always answers the same way so the form cannot reveal which emails have accounts. */
export async function customerRequestReset(email: string) {
  const store = await getPublicStore();
  const acct = await store.elevated().findCustomerAccountByEmail(email);
  if (!acct?.is_active) return;
  const link = await (await getCustomerAuth()).passwordLink(acct.id, acct.email, "reset");
  await sendEmail(store, {
    order_id: null,
    to: acct.email,
    subject: "Reset your JJ Furniture password",
    text: `Hello ${acct.full_name},\n\nUse this link to choose a new password (works once, expires in 24 hours):\n${link}\n\nIf you did not ask for this, ignore this email; your password stays the same.`,
  });
}

/**
 * Sets the password from a set-up / reset link.
 *  - demo: the one-time token from the link
 *  - production: the recovery session created by /customer/auth/confirm
 */
export async function customerSetPassword(token: string | null, password: string) {
  const store = await getPublicStore();
  if (useSupabaseAuth()) {
    const supabase = await createUserClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw new DomainError("VALIDATION", "This link is invalid or has expired. Ask for a new one from the login page.");
    const acct = await store.elevated().getCustomerAccount(data.user.id);
    if (!acct?.is_active) throw new DomainError("FORBIDDEN", "This account is not active.");
    const problem = passwordProblem(password, acct.email);
    if (problem) throw new DomainError("VALIDATION", problem);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new DomainError("VALIDATION", error.message);
    return acct;
  }
  if (!token) throw new DomainError("VALIDATION", "This link is invalid or has expired. Ask for a new one from the login page.");
  const { user_id } = await demoCompletePassword(store, token, password);
  await setDemoCustomerCookie(user_id);
  return (await store.elevated().getCustomerAccount(user_id))!;
}
