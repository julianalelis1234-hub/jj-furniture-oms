import "server-only";
import { headers } from "next/headers";

/**
 * True when the browser reached us over HTTPS (directly or via a proxy such as
 * Vercel). Cookies are marked Secure only then: on a plain-http LAN address
 * (testing on a phone via http://192.168.x.x:3000) browsers drop Secure cookies,
 * which would make sign-in silently fail.
 */
export async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return process.env.NODE_ENV === "production" && !/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(h.get("host") ?? "");
}
