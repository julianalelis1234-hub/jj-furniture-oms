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
import { siteUrl } from "@/lib/services/email";
import { getPublicStore } from "./context";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { isHttpsRequest } from "./request";
import { createAdminClient, createUserClient } from "./supabase";
import { signToken, verifyToken } from "./token";

/** Demo customer login cookie (production uses the Supabase Auth session cookies). */
export const CUSTOMER_AUTH_COOKIE = "jj_customer_auth";
/** Review session: ONE order + ONE quotation revision, short-lived, http-only. */
export const REVIEW_COOKIE = "jj_review";
const REVIEW_TTL_S = 30 * 60;
const CUSTOMER_TTL_S = 8 * 60 * 60;

const supabaseAuthEnabled = () => !isDemoMode() && hasSupabase();

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
      // Generated server-side at send time, delivered by OUR mailer (not Supabase's rate-limited one).
      // The link targets our /auth/callback, which verifies the token hash server-side (verifyOtp) and
      // sets the session cookies; it is never stored in plaintext.
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: email.trim().toLowerCase(),
        options: { redirectTo: `${siteUrl()}/auth/callback?next=/customer/set-password` },
      });
      const hashed = data?.properties?.hashed_token;
      if (error || !hashed) throw new DomainError("BACKEND", "Could not create the password link.");
      return `${siteUrl()}/auth/callback?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=/customer/set-password`;
    },
    async emailVerified(userId) {
      const { data } = await admin.auth.admin.getUserById(userId);
      return !!data.user?.email_confirmed_at;
    },
    async hasPassword(userId) {
      const { data } = await admin.auth.admin.getUserById(userId);
      return !!data.user?.last_sign_in_at;
    },
  };
}

export async function getCustomerAuth(): Promise<CustomerAuthProvider> {
  const store = await getPublicStore();
  return supabaseAuthEnabled() ? supabaseCustomerAuth(store) : demoCustomerAuth(store);
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
/** The signed-in customer (never a staff member), or null. The session is checked before any data access. */
export async function getCustomer(): Promise<CustomerAccount | null> {
  let uid: string | null = null;
  if (supabaseAuthEnabled()) {
    const { data } = await (await createUserClient()).auth.getUser();
    uid = data.user?.id ?? null;
  } else {
    uid = verifyToken<{ uid: string }>((await cookies()).get(CUSTOMER_AUTH_COOKIE)?.value)?.uid ?? null;
  }
  if (!uid) return null;
  const acct = await (await getPublicStore()).elevated().getCustomerAccount(uid);
  return acct?.is_active ? acct : null;
}

/**
 * Store for a signed-in customer's own data. In production its default client
 * carries the CUSTOMER's JWT, so order reads go through the RLS policy
 * orders_select_customer_own (customer_user_id = auth.uid(), migration 006):
 * the database itself decides which orders are theirs. elevated() is used only
 * afterwards, for the details of an order the database already returned.
 * Demo: the demo store; the services still check customer_user_id themselves.
 */
export async function getCustomerStore(): Promise<DataStore> {
  if (supabaseAuthEnabled()) return new SupabaseStore(await createUserClient(), createAdminClient());
  return getPublicStore(); // demo: same store as the rest of the demo portal
}

async function setDemoCustomerCookie(uid: string) {
  (await cookies()).set(CUSTOMER_AUTH_COOKIE, signToken({ uid }, CUSTOMER_TTL_S), {
    httpOnly: true, sameSite: "lax", secure: await isHttpsRequest(), path: "/", maxAge: CUSTOMER_TTL_S,
  });
}

const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";

export async function customerSignIn(email: string, password: string) {
  const store = await getPublicStore();
  if (supabaseAuthEnabled()) {
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
  if (supabaseAuthEnabled()) await (await createUserClient()).auth.signOut();
  (await cookies()).delete({ name: CUSTOMER_AUTH_COOKIE, path: "/" });
}


/**
 * Sets the password from a set-up / reset link.
 *  - demo: the one-time token from the link
 *  - production: the recovery session created by /auth/callback (verifyOtp)
 */
export async function customerSetPassword(token: string | null, password: string) {
  const store = await getPublicStore();
  if (supabaseAuthEnabled()) {
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
