import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { DataStore } from "@/lib/data/store";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DomainError } from "@/lib/domain/errors";
import { siteUrl } from "./email";

/**
 * Customer account operations that live in the auth system. Production uses
 * Supabase Auth (src/lib/server/customer-auth-supabase.ts); demo mode uses the
 * in-memory stand-in below. Neither ever creates or emails a plaintext password.
 */
export interface CustomerAuthProvider {
  /** Creates a login with NO password (and the 'customer' profile) for an email. Returns the user id. */
  createAccount(email: string, fullName: string): Promise<string>;
  /** Time-limited link to set (new account) or reset the password. */
  passwordLink(userId: string, email: string, purpose: "setup" | "reset"): Promise<string>;
  /** Whether the account has ever set a password (returning customers are not sent a new set-up link). */
  hasPassword(userId: string): Promise<boolean>;
  /** Whether the auth system marks the account's email as verified. */
  emailVerified(userId: string): Promise<boolean>;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newSecret = () => randomBytes(32).toString("base64url");

export const PASSWORD_LINK_TTL_MS = 24 * 3600_000;
export const MIN_PASSWORD = 8;

export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 128) return "Use at most 128 characters.";
  if (email && pw.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Do not use your email name in the password.";
  if (/^(.)\1+$/.test(pw)) return "Choose a less predictable password.";
  return null;
}

// ------------------------------------------------------------------ demo ----
export function demoCustomerAuth(store: DataStore): CustomerAuthProvider {
  const t = (store.elevated() as MemoryStore).t;
  return {
    async createAccount(email, fullName) {
      const id = crypto.randomUUID();
      await store.elevated().insertCustomerProfile({ id, email, full_name: fullName });
      return id;
    },
    async passwordLink(userId, _email, purpose) {
      const raw = newSecret();
      // one live link per account and purpose
      for (const x of t.password_tokens) if (x.user_id === userId && !x.used_at) x.used_at = new Date().toISOString();
      t.password_tokens.push({ token_hash: sha256(raw), user_id: userId, purpose, expires_at: new Date(Date.now() + PASSWORD_LINK_TTL_MS).toISOString(), used_at: null });
      return `${siteUrl()}/customer/set-password?token=${raw}`;
    },
    async hasPassword(userId) {
      return !!t.customer_accounts.find((a) => a.id === userId)?.password_hash;
    },
    async emailVerified(userId) {
      // demo accounts are only ever created after the review link proved the inbox
      return !!t.customer_accounts.find((a) => a.id === userId);
    },
  };
}

/** Demo: completes a set-up / reset link (single use, expiring) and stores a bcrypt hash. */
export async function demoCompletePassword(store: DataStore, rawToken: string, password: string) {
  const t = (store.elevated() as MemoryStore).t;
  const tok = t.password_tokens.find((x) => x.token_hash === sha256(rawToken));
  if (!tok || tok.used_at || Date.now() > Date.parse(tok.expires_at))
    throw new DomainError("VALIDATION", "This link is invalid or has expired. Ask for a new one from the login page.");
  const acct = t.customer_accounts.find((a) => a.id === tok.user_id);
  if (!acct || !acct.is_active) throw new DomainError("FORBIDDEN", "This account is not active.");
  const problem = passwordProblem(password, acct.email);
  if (problem) throw new DomainError("VALIDATION", problem);
  tok.used_at = new Date().toISOString();
  acct.password_hash = await bcrypt.hash(password, 10);
  return { user_id: acct.id, email: acct.email };
}

/** Demo login: constant-shape failure so emails cannot be enumerated. */
export async function demoVerifyPassword(store: DataStore, email: string, password: string) {
  const t = (store.elevated() as MemoryStore).t;
  const acct = t.customer_accounts.find((a) => a.email === email.trim().toLowerCase());
  const ok = !!acct?.password_hash && acct.is_active && (await bcrypt.compare(password, acct.password_hash));
  if (!ok) throw new DomainError("FORBIDDEN", "Email or password is incorrect.");
  return { user_id: acct!.id, email: acct!.email };
}
