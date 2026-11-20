import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { hasSupabase, isDemoMode } from "@/lib/config";
import type { DataStore } from "@/lib/data/store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { DomainError } from "@/lib/domain/errors";
import type { Actor, Role } from "@/lib/domain/types";
import { getMemoryStore } from "./memory";
import { createAdminClient, createUserClient } from "./supabase";
import { isHttpsRequest } from "./request";
import { signToken, verifyToken } from "./token";

export const DEMO_COOKIE = "jj_demo_session";

export const PORTAL_FOR: Record<Role, string> = {
  owner: "/owner",
  staff: "/staff",
  craftsman: "/craftsman",
  driver: "/driver",
};

/**
 * Data store for a server request.
 *  - production: Supabase with the staff member's JWT (RLS enforced) + admin for elevated()
 *  - demo + Supabase configured: service-role client (role switcher has no JWT; demo projects only)
 *  - demo without Supabase: in-memory store seeded with sample data
 */
export const getStore = cache(async (): Promise<DataStore> => {
  if (!isDemoMode()) {
    if (!hasSupabase()) throw new DomainError("BACKEND", "Production mode requires Supabase environment variables.");
    return new SupabaseStore(await createUserClient(), createAdminClient());
  }
  if (hasSupabase()) {
    const admin = createAdminClient();
    if (!admin) throw new DomainError("BACKEND", "Demo mode on Supabase requires SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseStore(admin, admin);
  }
  return getMemoryStore();
});

/**
 * Store for the public customer portal. The customer RPCs are callable only by
 * the server (service role, migration 002), so a browser can never call the PIN
 * check directly and dodge the rate limit. Full order data is read only after
 * the PIN has been verified (see customer-session.ts).
 */
export const getPublicStore = cache(async (): Promise<DataStore> => {
  if (hasSupabase()) {
    const admin = createAdminClient();
    if (!admin) throw new DomainError("BACKEND", "Customer portal requires SUPABASE_SERVICE_ROLE_KEY on the server.");
    return new SupabaseStore(admin, admin);
  }
  if (!isDemoMode()) throw new DomainError("BACKEND", "Production mode requires Supabase environment variables.");
  return getMemoryStore();
});

/** Resolves the current staff actor entirely on the server. Never trusts client state. */
export const getActor = cache(async (): Promise<Actor | null> => {
  if (isDemoMode()) {
    const token = (await cookies()).get(DEMO_COOKIE)?.value;
    const data = verifyToken<{ uid: string }>(token);
    if (!data) return null;
    const store = await getStore();
    const profile = (await store.listProfiles()).find((p) => p.id === data.uid && p.is_active);
    return profile ? { id: profile.id, role: profile.role, full_name: profile.full_name, source: "demo" } : null;
  }
  if (!hasSupabase()) return null;
  const supabase = await createUserClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  // Role comes from the profiles table (RLS: a signed-in active staff member can read profiles).
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;
  return { id: profile.id, role: profile.role as Role, full_name: profile.full_name, source: "auth" };
});

export async function requireActor(allowed: Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(isDemoMode() ? "/" : "/login");
  if (!allowed.includes(actor.role)) redirect(PORTAL_FOR[actor.role]);
  return actor;
}

/** For server actions: throws instead of redirecting. */
export async function authorize(allowed: Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new DomainError("FORBIDDEN", "Please sign in again.");
  if (!allowed.includes(actor.role)) throw new DomainError("FORBIDDEN", "Your role cannot perform this action.");
  return actor;
}

export async function setDemoSession(profileId: string) {
  (await cookies()).set(DEMO_COOKIE, signToken({ uid: profileId }, 60 * 60 * 24 * 30), {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttpsRequest(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
