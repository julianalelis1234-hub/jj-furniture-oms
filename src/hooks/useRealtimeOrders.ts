"use client";

/**
 * useRealtimeOrders — the ONE managed live-sync subscription per viewer scope.
 *
 *  - Production: one Supabase Realtime channel on public.order_live_events
 *    (RLS decides which rows this signed-in user receives). A Realtime message
 *    is only a HINT: the hook then asks the server (fetchLiveEventsAction) for
 *    the authoritative, authorized rows. Payload content is never trusted.
 *  - Demo (NEXT_PUBLIC_APP_MODE=demo): no Realtime server. BroadcastChannel
 *    ('jj-furniture-realtime') carries bare "look again" pings between tabs of
 *    this browser, plus a short poll so other browsers catch up too.
 *
 * Components that mount the hook with the same scope share one manager and one
 * channel (reference-counted). It is torn down (removeChannel) on unmount and
 * whenever the signed-in user / role (the scope) changes.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { fetchLiveEventsAction } from "@/app/live-actions";
import { backoffDelay, DEBOUNCE_MS, isLivePing, LiveState, MAX_QUEUE, type IngestResult, type LiveStatus, type LivePing } from "@/lib/realtime/core";
import type { LiveViewerRole } from "@/lib/realtime/events";

export const LIVE_BROADCAST_CHANNEL = "jj-furniture-realtime";
const DEMO_POLL_MS = 4000;
const FALLBACK_POLL_MS = 30_000;
const FALLBACK_AFTER_FAILURES = 3;

export interface LiveBatch extends IngestResult {
  /** reconnect / overflow / truncated page: re-read the page data even if `changed` is empty */
  reconcile: boolean;
}

export interface RealtimeScope {
  /** `${role}:${userId}` from the server; the subscription is rebuilt when it changes */
  viewerKey: string;
  role: LiveViewerRole;
  /** feed id already reflected in the server-rendered page */
  cursor: number;
  demo: boolean;
}

type Listener = { batch: (b: LiveBatch) => void; status: (s: LiveStatus) => void };

class LiveSyncManager {
  private listeners = new Set<Listener>();
  private state: LiveState;
  status: LiveStatus = "connecting";
  private destroyed = false;
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private authSub: { unsubscribe(): void } | null = null;
  private bc: BroadcastChannel | null = null;
  private timers = { debounce: 0, retry: 0, poll: 0 };
  private attempt = 0;
  private queued = 0;
  private overflow = false;
  private reconcileNext = true; // first fetch reconciles anything committed while the page was rendering
  private fetching = false;
  private again = false;
  private lastPinged = 0;
  private readonly onOnline = () => this.handleOnline();
  private readonly onOffline = () => this.setStatus("offline");

  constructor(private scope: RealtimeScope) {
    this.state = new LiveState(scope.role, scope.cursor);
  }

  start() {
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    if (this.scope.demo) {
      try {
        this.bc = new BroadcastChannel(LIVE_BROADCAST_CHANNEL);
        this.bc.onmessage = (m) => { if (isLivePing(m.data)) this.signal(); }; // anything else is ignored
      } catch { /* older browser: the poll below still works */ }
      this.startPoll(DEMO_POLL_MS);
      this.signal();
    } else {
      void this.connect();
    }
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    l.status(this.status);
    return () => this.listeners.delete(l);
  }
  get size() { return this.listeners.size; }

  /** The server just rendered the page up to `cursor` (e.g. after this tab's own action). */
  noteRendered(cursor: number) {
    this.state.noteRendered(cursor);
    if (this.scope.demo && cursor > this.lastPinged) this.ping(cursor);
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    clearTimeout(this.timers.debounce); clearTimeout(this.timers.retry); clearInterval(this.timers.poll);
    this.teardownChannel();
    this.authSub?.unsubscribe();
    this.bc?.close();
    this.listeners.clear();
  }

  // ------------------------------------------------------------ connection
  private async connect() {
    if (this.destroyed) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return this.setStatus("offline");
    try {
      if (!this.client) {
        const { getBrowserSupabase } = await import("@/lib/realtime/supabase-browser");
        this.client = getBrowserSupabase();
        if (!this.client) return this.fallbackOnly();
        const { data } = this.client.auth.onAuthStateChange((event, session) => {
          if (event === "TOKEN_REFRESHED" && session) {
            void this.client!.realtime.setAuth(session.access_token);
            this.reconcile(); // re-read anything missed around the refresh
          } else if (event === "SIGNED_OUT") {
            this.setStatus("offline");
            this.teardownChannel();
          }
        });
        this.authSub = data.subscription;
      }
      const { data } = await this.client.auth.getSession();
      if (!data.session) return this.setStatus("offline");
      await this.client.realtime.setAuth(data.session.access_token);
      this.teardownChannel();
      this.channel = this.client
        .channel(`live:${this.scope.viewerKey}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_live_events" }, () => this.signal())
        .subscribe((st) => {
          if (this.destroyed) return;
          if (st === "SUBSCRIBED") {
            this.attempt = 0;
            clearInterval(this.timers.poll);
            this.setStatus("live");
            this.reconcile(); // catch up on whatever happened while disconnected
          } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
            this.scheduleReconnect();
          }
        });
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.teardownChannel();
    if (typeof navigator !== "undefined" && !navigator.onLine) return this.setStatus("offline");
    this.setStatus("reconnecting");
    clearTimeout(this.timers.retry);
    // after a few failures keep the page fresh with ordinary fetching until Realtime is back
    if (this.attempt + 1 >= FALLBACK_AFTER_FAILURES) this.startPoll(FALLBACK_POLL_MS);
    this.timers.retry = window.setTimeout(() => void this.connect(), backoffDelay(this.attempt++));
  }

  private fallbackOnly() {
    this.startPoll(FALLBACK_POLL_MS);
    this.signal();
  }

  private teardownChannel() {
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.channel = null;
  }

  private handleOnline() {
    this.attempt = 0;
    if (this.scope.demo) this.reconcile();
    else void this.connect();
  }

  private startPoll(ms: number) {
    clearInterval(this.timers.poll);
    this.timers.poll = window.setInterval(() => this.signal(), ms);
  }

  // ------------------------------------------------------------- fetching
  /** A hint arrived. Debounced; a burst of hints becomes one authoritative fetch. */
  private signal() {
    if (this.destroyed) return;
    if (++this.queued > MAX_QUEUE) this.overflow = true; // bounded: past this we just re-read everything once
    clearTimeout(this.timers.debounce);
    this.timers.debounce = window.setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  private reconcile() {
    this.reconcileNext = true;
    this.signal();
  }

  private async flush() {
    if (this.destroyed) return;
    if (this.fetching) { this.again = true; return; }
    this.fetching = true;
    const reconcile = this.reconcileNext || this.overflow;
    this.reconcileNext = false;
    this.overflow = false;
    this.queued = 0;
    try {
      const before = this.state.lastId;
      const r = await fetchLiveEventsAction(this.state.afterForFetch());
      if (this.destroyed) return;
      if (!r.ok) {
        if (r.reason === "signed_out") { this.setStatus("offline"); this.destroyListenersOnly(); }
        else if (this.scope.demo) this.setStatus("offline");
        return;
      }
      if (r.viewerKey !== this.scope.viewerKey) { this.setStatus("offline"); this.destroyListenersOnly(); return; } // another user signed in
      if (this.scope.demo) this.setStatus("live");
      const result = this.state.ingest(r.events);
      if (result.changed.length || result.stale || reconcile || r.truncated)
        this.emit({ ...result, reconcile: reconcile || r.truncated || result.stale });
      if (this.scope.demo && this.state.lastId > before) this.ping(this.state.lastId);
      if (r.truncated) this.again = true;
    } catch {
      if (this.scope.demo || !navigator.onLine) this.setStatus("offline");
    } finally {
      this.fetching = false;
      if (this.again) { this.again = false; this.signal(); }
    }
  }

  private destroyListenersOnly() {
    clearInterval(this.timers.poll);
    this.teardownChannel();
  }

  private ping(cursor: number) {
    this.lastPinged = cursor;
    const msg: LivePing = { type: "jj-live-ping", v: 1, cursor };
    try { this.bc?.postMessage(msg); } catch { /* closed */ }
  }

  private emit(b: LiveBatch) { for (const l of this.listeners) l.batch(b); }
  private setStatus(s: LiveStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.listeners) l.status(s);
  }
}

// one manager per scope, shared by every component that asks for it
const registry = new Map<string, { mgr: LiveSyncManager; refs: number }>();
const scopeKeyOf = (s: RealtimeScope) => `${s.demo ? "demo" : "live"}:${s.viewerKey}`;

export function useRealtimeOrders(scope: RealtimeScope | null, onBatch: (b: LiveBatch) => void): LiveStatus | null {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const batchRef = useRef(onBatch);
  useEffect(() => { batchRef.current = onBatch; });
  const key = scope ? scopeKeyOf(scope) : null;
  const cursor = scope?.cursor ?? 0;
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; });

  useEffect(() => {
    const s = scopeRef.current;
    if (!key || !s) return;
    let entry = registry.get(key);
    if (!entry) {
      entry = { mgr: new LiveSyncManager(s), refs: 0 };
      registry.set(key, entry);
      entry.mgr.start();
    }
    entry.refs++;
    const off = entry.mgr.subscribe({ batch: (b) => batchRef.current(b), status: setStatus });
    return () => {
      off();
      const e = registry.get(key);
      if (e && --e.refs <= 0) {
        e.mgr.destroy(); // removeChannel + timers + BroadcastChannel
        registry.delete(key);
      }
    };
  }, [key]);

  // every server re-render tells the manager what is already on screen
  useEffect(() => {
    if (key) registry.get(key)?.mgr.noteRendered(cursor);
  }, [key, cursor]);

  return key ? status : null;
}
