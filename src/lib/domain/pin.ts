import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

/** Random 4-digit customer PIN (crypto-strength). */
export function generatePin(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

/**
 * bcrypt hash compatible with pgcrypto's crypt() (which accepts `$2a$` but
 * not `$2b$`; the two are identical for short inputs like a 4-digit PIN).
 */
export function hashPin(pin: string, rounds = 10): string {
  return bcrypt.hashSync(pin, rounds).replace(/^\$2b\$/, "$2a$");
}

export function verifyPinHash(pin: string, hash: string): boolean {
  return /^\d{4}$/.test(pin) && bcrypt.compareSync(pin, hash);
}
