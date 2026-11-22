import { after, NextResponse } from "next/server";
import { requestSetupLink, SETUP_LINK_GENERIC } from "@/lib/email/requests";
import { getPublicStore } from "@/lib/server/context";
import { getCustomerAuth } from "@/lib/server/customer-auth";
import { clientIp } from "@/lib/server/request-meta";

/**
 * Public: request a fresh password set-up link (expired / lost link).
 * Identical answer for registered, unregistered, unverified or blocked emails;
 * rate-limited per client IP and per HMAC of the normalized email.
 */
export async function POST(req: Request) {
  const json = (await req.json().catch(() => null)) as { email?: unknown } | null;
  try {
    const r = await requestSetupLink(await getPublicStore(), await getCustomerAuth(), { email: json?.email, clientIp: await clientIp() }, (task) => after(task));
    return NextResponse.json({ message: r.message }, { status: r.status });
  } catch {
    return NextResponse.json({ message: SETUP_LINK_GENERIC }, { status: 200 }); // never leak why
  }
}
