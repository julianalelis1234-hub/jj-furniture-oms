import { DomainError } from "@/lib/domain/errors";
import type { Actor, Role } from "@/lib/domain/types";

export function ensureRole(actor: Actor, roles: Role[], action = "perform this action"): void {
  if (!roles.includes(actor.role)) {
    throw new DomainError("FORBIDDEN", `A ${actor.role} cannot ${action}.`);
  }
}

/** Deterministic UUID derived from another UUID (for split payments in one offline action). */
export async function deriveUuid(base: string, salt: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${base}:${salt}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5-style
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
