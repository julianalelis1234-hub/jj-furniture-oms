import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabase, isDemoMode } from "@/lib/config";
import { getPublicStore } from "@/lib/server/context";
import { createUserClient } from "@/lib/server/supabase";

const ALLOWED_NEXT = new Set(["/customer/set-password"]);

/**
 * Supabase Auth callback (installed SDK: @supabase/ssr 0.12 + supabase-js 2.119).
 * Our emailed set-up links are generated server-side with auth.admin.generateLink,
 * which cannot use PKCE, so they arrive as `token_hash` + `type=recovery` and are
 * verified with verifyOtp(). Only if a PKCE `code` arrives instead (e.g. a Supabase
 * dashboard-sent email) is exchangeCodeForSession() used — never both.
 * The session it creates is a normal customer session: /customer/orders still
 * shows only orders where customer_user_id = auth.uid() (server check + RLS).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fail = () => NextResponse.redirect(new URL("/customer/forgot-password?expired=1", url));
  if (isDemoMode() || !hasSupabase()) return NextResponse.redirect(new URL("/customer/login", url));
  const next = url.searchParams.get("next") ?? "/customer/set-password";
  const target = ALLOWED_NEXT.has(next) ? next : "/customer/set-password"; // no open redirect
  const supabase = await createUserClient();

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  let userId: string | undefined;
  if (tokenHash && type) {
    if (type !== "recovery") return fail();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail();
    userId = data.user?.id;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail();
    userId = data.user?.id;
  } else return fail();

  // the session must belong to an active CUSTOMER account (staff use their own sign-in)
  const acct = userId ? await (await getPublicStore()).elevated().getCustomerAccount(userId) : null;
  if (!acct?.is_active) {
    await supabase.auth.signOut();
    return fail();
  }
  return NextResponse.redirect(new URL(target, url));
}
