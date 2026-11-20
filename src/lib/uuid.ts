/**
 * RFC 4122 v4 UUID that also works on plain-http LAN addresses
 * (e.g. http://192.168.1.5:3000 on a phone), where browsers hide
 * crypto.randomUUID because the page is not a "secure context".
 * crypto.getRandomValues is available in every context.
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
