import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

/**
 * Client IP for rate limiting. The LEFT-most X-Forwarded-For entry is whatever the
 * client sent, so it is never trusted: proxies APPEND the address they saw. With
 * TRUSTED_PROXY_HOPS proxies in front (default 1), the client is the entry that
 * many positions from the right. X-Real-IP is used only when X-Forwarded-For is absent.
 */
export function pickClientIp(xff: string | null, realIp: string | null, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string {
  const list = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Number.isInteger(hops) && hops > 0 ? hops : 1;
  const ip = list.length ? list[Math.max(0, list.length - n)] : realIp?.trim();
  return (ip || "unknown").slice(0, 64);
}
export async function clientIp(): Promise<string> {
  const h = await headers();
  return pickClientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

/**
 * Cron authorization: exactly `Authorization: Bearer ${CRON_SECRET}`, compared in
 * constant time (both sides hashed to equal length first). A browser session,
 * cookie or role is never enough. Missing / short secret = endpoint disabled.
 */
export function cronAuthorized(authorization: string | null, secret = process.env.CRON_SECRET): "ok" | "unauthorized" | "disabled" {
  if (!secret || secret.length < 32) return "disabled";
  const m = authorization?.match(/^Bearer (.+)$/);
  if (!m) return "unauthorized";
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
