import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isDemoMode } from "@/lib/config";

const g = globalThis as unknown as { __jjEphemeralSecret?: string };

function secret(): string {
  const s = process.env.JJ_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (!isDemoMode()) {
    throw new Error("JJ_SESSION_SECRET (32+ chars) must be set in production mode.");
  }
  // Demo without a configured secret: a per-process random secret (tokens reset on restart).
  g.__jjEphemeralSecret ??= randomBytes(32).toString("hex");
  return g.__jjEphemeralSecret;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString();

/** Compact signed token: base64url(json).hmac — tamper-evident, with expiry. */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string | undefined | null): (T & { exp: number }) | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(unb64(body)) as T & { exp: number };
    if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}
