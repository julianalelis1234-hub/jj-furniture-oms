/**
 * Pure live-sync logic (no browser, no network): deduplication, ordering,
 * "already rendered" tracking and the notification rules. Unit-tested.
 *
 * Notifications come ONLY from the transition the database classified from
 * committed state (order_live_events.transition) — never from the mere fact
 * that a row was inserted or updated.
 */
import type { LiveEvent, LiveViewerRole } from "./events";

export const DEBOUNCE_MS = 300;
/** Max pending signals before we stop counting and do one full authoritative re-fetch. */
export const MAX_QUEUE = 200;
/** Re-read this many ids below the last one seen (concurrent commits can land slightly out of id order). */
export const OVERLAP = 25;
const MAX_SEEN = 2000;

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface LiveToast {
  key: string;
  order_id: string;
  title: string;
  description: string;
}

export interface IngestResult {
  /** new, in-order events not yet reflected in the page */
  changed: LiveEvent[];
  toasts: LiveToast[];
  /** an older / out-of-order event arrived: the page must re-read authoritative state */
  stale: boolean;
}

/** (table, record, operation, commit time) — revision numbers alone are not unique per change. */
export const dedupKey = (e: Pick<LiveEvent, "source" | "record_id" | "op" | "occurred_at" | "id">) =>
  `${e.source}:${e.record_id}:${e.op}:${e.occurred_at}:${e.id}`;

const stamp = (e: LiveEvent) => {
  const t = Date.parse(e.order_updated_at ?? e.occurred_at);
  return Number.isFinite(t) ? t : 0;
};

/** Notification for one event, or null. Mirrors the spec's verified-transition rules. */
export function toastFor(e: LiveEvent, role: LiveViewerRole): LiveToast | null {
  if (!e.transition) return null; // e.g. an internal note edit: a refresh signal, never a notification
  if (e.actor_role === role) return null; // this role made the change and already saw the result
  const code = e.order_code ?? "An order";
  const office = role === "owner" || role === "staff";
  const base = { order_id: e.order_id, key: `${e.order_id}:${e.transition}:${e.status}:${e.source === "payments" ? e.record_id : ""}` };
  if (office) {
    if (e.transition === "quote_requested" && e.op === "INSERT" && e.status === "Quote Requested")
      return { ...base, title: "New quote request", description: `${code} is waiting for a quotation.` };
    if (e.transition === "quote_accepted" && e.status === "Confirmed")
      return { ...base, title: "Quotation accepted", description: `${code} is now Confirmed (specification + quotation accepted).` };
    if (e.transition === "stage_progress" && e.status)
      return { ...base, title: "Order progress", description: `${code}: ${e.prev_status} → ${e.status}` };
    return null;
  }
  if (role === "customer") {
    if (e.transition === "payment_verified" && e.source === "payments" && e.payment_verified === true)
      return { ...base, title: "Payment verified", description: `JJ Enterprises verified a payment for ${code}.` };
    if ((e.transition === "stage_progress" || e.transition === "quote_accepted") && e.status)
      return { ...base, title: "Order update", description: `${code} is now ${e.status}.` };
  }
  return null; // craftsmen and drivers: live board updates, no pop-up notifications
}

export class LiveState {
  private seen = new Set<string>();
  private latest = new Map<string, { at: number; id: number }>();
  private toasted = new Set<string>();
  /** ids <= rendered are already reflected in the server-rendered page */
  private rendered: number;
  lastId: number;

  constructor(
    private role: LiveViewerRole,
    renderedCursor: number,
  ) {
    this.rendered = renderedCursor;
    this.lastId = renderedCursor;
  }

  /** The page was (re-)rendered by the server up to this feed id. */
  noteRendered(cursor: number) {
    if (cursor > this.rendered) this.rendered = cursor;
    if (cursor > this.lastId) this.lastId = cursor;
  }

  afterForFetch() {
    return Math.max(0, this.lastId - OVERLAP);
  }

  ingest(events: LiveEvent[]): IngestResult {
    const changed: LiveEvent[] = [];
    const byOrder = new Map<string, LiveToast>();
    let stale = false;
    for (const e of [...events].sort((a, b) => a.id - b.id)) {
      const key = dedupKey(e);
      if (this.seen.has(key)) continue; // duplicate delivery / overlap re-read
      this.remember(key);
      if (e.id > this.lastId) this.lastId = e.id;
      const at = stamp(e);
      const prev = this.latest.get(e.order_id);
      const older = !!prev && (at < prev.at || (at === prev.at && e.id < prev.id));
      if (e.id <= this.rendered) {
        // already on screen: remember its time, never notify again (reconnect reconciliation)
        if (!older) this.latest.set(e.order_id, { at, id: e.id });
        continue;
      }
      if (older && e.op !== "DELETE") {
        stale = true; // never let an out-of-order event overwrite newer state
        continue;
      }
      this.latest.set(e.order_id, { at, id: e.id });
      changed.push(e);
      const t = toastFor(e, this.role);
      if (t && !this.toasted.has(t.key)) {
        this.toasted.add(t.key);
        byOrder.set(e.order_id, t); // after a gap, only the newest state per order is announced
      }
    }
    return { changed, toasts: [...byOrder.values()], stale };
  }

  private remember(key: string) {
    this.seen.add(key);
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value!);
  }
}

/** Exponential reconnection backoff with jitter: 0.5–1 s, 1–2 s, … capped at 30 s. */
export function backoffDelay(attempt: number, rand: () => number = Math.random) {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base / 2 + (rand() * base) / 2);
}

/** Demo cross-tab message: a bare "look again" hint, never data, tokens or credentials. */
export interface LivePing {
  type: "jj-live-ping";
  v: 1;
  cursor: number;
}
export function isLivePing(x: unknown): x is LivePing {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return Object.keys(o).length === 3 && o.type === "jj-live-ping" && o.v === 1 && Number.isSafeInteger(o.cursor) && (o.cursor as number) >= 0;
}
