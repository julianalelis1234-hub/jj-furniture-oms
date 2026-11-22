"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

let client: SupabaseClient | null = null;

/**
 * Browser client with the signed-in user's OWN session (anon key + user JWT
 * from the auth cookies). Used only to receive Realtime hints; RLS applies.
 * Never holds the service-role key.
 */
export function getBrowserSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
