import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isDemoMode } from "@/lib/config";

/**
 * AES-256-GCM envelopes for secrets that must wait in notification_outbox
 * (a single-use review token, a generated password set-up link).
 *
 *   OUTBOX_TOKEN_ENCRYPTION_KEY            base64 of exactly 32 random bytes (required)
 *   OUTBOX_TOKEN_ENCRYPTION_KEYS_PREVIOUS  optional comma-separated base64 keys, read-only,
 *                                          so rows encrypted before a rotation stay readable
 *
 * Envelope (JSON in notification_outbox.encrypted_payload):
 *   { v: key id (first 8 hex of SHA-256 of the key), iv: 12-byte nonce, tag: 16-byte GCM tag, ct }
 * A fresh random 96-bit nonce is drawn for every encryption. The outbox row's
 * idempotency key is bound as additional authenticated data, so an envelope
 * cannot be moved onto a different row.
 *
 * Fail closed: a missing or malformed key throws OutboxKeyError — there is no
 * plaintext fallback. Demo Mode only (NEXT_PUBLIC_APP_MODE=demo, in-memory data)
 * may use a random per-process key when none is configured.
 */
export class OutboxKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxKeyError";
  }
}
export class OutboxDecryptError extends Error {
  constructor() {
    super("Encrypted outbox payload could not be authenticated or decrypted.");
    this.name = "OutboxDecryptError";
  }
}

export interface Envelope {
  v: string;
  iv: string;
  tag: string;
  ct: string;
}
interface Key {
  id: string;
  key: Buffer;
}
export interface Keyring {
  current: Key;
  byId: Map<string, Buffer>;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parseKey(raw: string, name: string): Key {
  const s = raw.trim();
  if (!s || !B64.test(s) || s.length % 4 !== 0) throw new OutboxKeyError(`${name} must be base64 (32 random bytes).`);
  const key = Buffer.from(s, "base64");
  if (key.length !== 32) throw new OutboxKeyError(`${name} must decode to exactly 32 bytes (got ${key.length}).`);
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 8), key };
}

const g = globalThis as unknown as { __jjOutboxDemoKey?: Buffer };

/** Reads and validates the keys every time (cheap), so a bad deploy fails at first use. */
export function loadKeyring(env: Record<string, string | undefined> = process.env, demo = isDemoMode()): Keyring {
  const cur = env.OUTBOX_TOKEN_ENCRYPTION_KEY;
  let current: Key;
  if (cur && cur.trim()) current = parseKey(cur, "OUTBOX_TOKEN_ENCRYPTION_KEY");
  else if (demo) {
    g.__jjOutboxDemoKey ??= randomBytes(32);
    current = { id: "demo0000", key: g.__jjOutboxDemoKey };
  } else throw new OutboxKeyError("OUTBOX_TOKEN_ENCRYPTION_KEY is not set; refusing to queue secrets (no plaintext fallback).");
  const byId = new Map<string, Buffer>([[current.id, current.key]]);
  for (const [i, p] of (env.OUTBOX_TOKEN_ENCRYPTION_KEYS_PREVIOUS ?? "").split(",").map((x) => x.trim()).filter(Boolean).entries()) {
    const k = parseKey(p, `OUTBOX_TOKEN_ENCRYPTION_KEYS_PREVIOUS[${i}]`);
    if (!byId.has(k.id)) byId.set(k.id, k.key);
  }
  return { current, byId };
}

export function encryptPayload(value: unknown, aad: string, ring: Keyring = loadKeyring()): string {
  const iv = randomBytes(12); // never reused: a new random 96-bit nonce per encryption
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const env: Envelope = { v: ring.current.id, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
  return JSON.stringify(env);
}

export function decryptPayload<T>(stored: string, aad: string, ring: Keyring = loadKeyring()): T {
  let env: Envelope;
  try {
    env = JSON.parse(stored) as Envelope;
  } catch {
    throw new OutboxDecryptError();
  }
  const key = ring.byId.get(env?.v);
  if (!key) throw new OutboxKeyError("The key that encrypted this payload is not configured (add it to OUTBOX_TOKEN_ENCRYPTION_KEYS_PREVIOUS).");
  const iv = Buffer.from(env.iv ?? "", "base64");
  const tag = Buffer.from(env.tag ?? "", "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new OutboxDecryptError();
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(tag); // verified in final(): a tampered tag / ciphertext / AAD throws
    const pt = Buffer.concat([d.update(Buffer.from(env.ct ?? "", "base64")), d.final()]);
    return JSON.parse(pt.toString("utf8")) as T;
  } catch {
    throw new OutboxDecryptError();
  }
}
