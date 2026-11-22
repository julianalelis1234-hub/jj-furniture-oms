/**
 * Shared email helpers. Delivery itself lives in src/lib/email/ (outbox +
 * mailer): business flows enqueue, the outbox sends.
 */

/** Any one-time link is replaced before text is written to a log or history row. */
export function redactLinks(text: string): string {
  return text.replace(/\S*[?&](token|token_hash|code)=\S+/gi, "[secure one-time link — not stored]");
}

/** Absolute base for links in emails; empty in demo without a configured URL (links are then site-relative). */
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
