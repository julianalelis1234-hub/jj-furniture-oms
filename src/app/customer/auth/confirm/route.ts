import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabase, isDemoMode } from "@/lib/config";
import { createUserClient } from "@/lib/server/supabase";

/**
 * Production: the emailed set-up / reset link (Supabase recovery token hash)
 * is verified here; Supabase sets the session cookies, then the customer
 * chooses a password on /customer/setup-password.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "recovery") as EmailOtpType;
  const next = url.searchParams.get("next") ?? "/customer/setup-password";
  const safeNext = next.startsWith("/customer/") ? next : "/customer/setup-password";
  if (isDemoMode() || !hasSupabase() || !tokenHash) return NextResponse.redirect(new URL("/customer/login", url));
  const supabase = await createUserClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  return NextResponse.redirect(new URL(error ? "/customer/forgot-password?expired=1" : safeNext, url));
}
