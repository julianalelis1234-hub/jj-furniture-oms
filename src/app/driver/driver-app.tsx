"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  CloudOff,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Truck,
  Wifi,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LIVE_DOM_EVENT } from "@/components/live-sync-client";
import { toast } from "sonner";
import { EmptyState } from "@/components/app-shell";
import { DesignNote } from "@/components/design-note";
import { Field, NativeSelect, TextArea, TextInput } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatDateTime, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import {
  enqueueAction,
  flushQueue,
  getManifest,
  getMeta,
  listQueue,
  openDriverDb,
  resolveConflict,
  saveManifest,
  setMeta,
  type CachedEntry,
  type DriverDb,
  type QueueItem,
} from "@/lib/offline/driver-db";
import type { DriverAction, DriverActionResult, ManifestEntry } from "@/lib/services/deliveries";
import { useBrowserOnline } from "@/lib/use-browser";
import { cn } from "@/lib/utils";
import { newUuid } from "@/lib/uuid";

type Tab = "today" | "upcoming" | "done";
type SyncState = "synced" | "offline" | "syncing" | "conflict";

class OfflineError extends Error {}

export function DriverApp({ driverId, initialManifest, serverTime }: { driverId: string; initialManifest: ManifestEntry[]; serverTime: string }) {
  const dbRef = useRef<DriverDb | null>(null);
  const [entries, setEntries] = useState<CachedEntry[]>(initialManifest);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [simulateOffline, setSimulateOffline] = useState(false);
  const browserOnline = useBrowserOnline();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastPreload, setLastPreload] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [dialog, setDialog] = useState<{ kind: "delivered" | "failed"; entry: CachedEntry } | null>(null);
  const [ready, setReady] = useState(false);
  const online = browserOnline && !simulateOffline;
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  const reload = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    setEntries(await getManifest(db));
    setQueue(await listQueue(db));
    setLastSync((await getMeta<string>(db, "last_sync")) ?? null);
    setLastPreload((await getMeta<string>(db, "last_preload")) ?? null);
  }, []);

  /** Honest transport: simulated offline never touches the network. */
  const send = useCallback(async (action: DriverAction): Promise<DriverActionResult> => {
    if (!onlineRef.current) throw new OfflineError("offline");
    const res = await fetch("/api/driver/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    if (res.status === 200 || res.status === 409) return res.json();
    throw new Error(`HTTP ${res.status}`); // keep queued
  }, []);

  const preload = useCallback(async (quiet = false) => {
    const db = dbRef.current;
    if (!db) return;
    if (!onlineRef.current) {
      if (!quiet) toast.error("No signal. Showing the assignments already saved on this phone.");
      return;
    }
    try {
      const res = await fetch("/api/driver/manifest", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { entries: ManifestEntry[] };
      await saveManifest(db, body.entries, driverId);
      await reload();
      if (!quiet) toast.success(`${body.entries.length} assignment(s) saved on this phone for offline travel.`);
    } catch {
      if (!quiet) toast.error("Could not download assignments. Using the copy saved on this phone.");
    }
  }, [driverId, reload]);

  const sync = useCallback(async (quiet = false) => {
    const db = dbRef.current;
    if (!db || syncing) return;
    if (!onlineRef.current) {
      if (!quiet) toast.warning("Still offline — your actions are saved on this phone.");
      return;
    }
    if ((await listQueue(db)).filter((q) => q.state === "pending").length === 0) {
      await preload(true);
      await setMeta(db, "last_sync", new Date().toISOString());
      await reload();
      return;
    }
    setSyncing(true);
    try {
      const s = await flushQueue(db, send);
      if (s.applied + s.duplicates > 0) toast.success(`Synced ${s.applied + s.duplicates} action(s) to the shop server.`);
      if (s.conflicts) toast.error(`${s.conflicts} action(s) need your review — the shop changed the order.`);
      if (s.rejected) toast.error(`${s.rejected} action(s) were refused by the server. See details below.`);
      if (s.networkError && !quiet) toast.warning("Signal dropped while syncing. Remaining actions stay on this phone.");
      if (!s.networkError) await preload(true);
    } finally {
      setSyncing(false);
      await reload();
    }
  }, [preload, reload, send, syncing]);

  // open IndexedDB (one database per driver so a shared phone never mixes queues)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await openDriverDb(`jj-oms-driver-${driverId}`);
      if (cancelled) return;
      dbRef.current = db;
      await saveManifest(db, initialManifest, driverId); // automatic caching on every online page load
      if ((await listQueue(db)).length === 0) await setMeta(db, "last_sync", serverTime);
      await reload();
      setReady(true);
    })().catch(() => toast.error("This browser cannot store offline data. Keep signal on while delivering."));
    // Service worker lets the driver re-open this page with no signal.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [driverId, initialManifest, serverTime, reload]);

  // live sync: an authorized change to an assigned delivery -> re-download through the offline-safe path
  useEffect(() => {
    const onLive = () => { if (ready && onlineRef.current) void sync(true); };
    window.addEventListener(LIVE_DOM_EVENT, onLive);
    return () => window.removeEventListener(LIVE_DOM_EVENT, onLive);
  }, [ready, sync]);

  // auto-sync whenever we (re)gain signal
  useEffect(() => {
    if (online && ready) void sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, ready]);

  async function record(entry: CachedEntry, type: DriverAction["type"], extra: Partial<DriverAction> = {}) {
    const db = dbRef.current;
    if (!db) return;
    const action: DriverAction = {
      client_transaction_id: newUuid(),
      type,
      delivery_id: entry.delivery.id,
      order_id: entry.order.id,
      base_version: entry.order.version,
      queued_at: new Date().toISOString(),
      ...extra,
    };
    await enqueueAction(db, action); // always saved locally first
    await reload();
    if (onlineRef.current) await sync(true);
    else toast.info("Saved Locally — Pending Sync");
  }

  const pending = queue.filter((q) => q.state === "pending");
  const problems = queue.filter((q) => q.state !== "pending");
  const state: SyncState = syncing ? "syncing" : problems.length ? "conflict" : !online ? "offline" : pending.length ? "offline" : "synced";
  const today = todayISO();
  const isDone = (e: CachedEntry) => e.delivery.dispatch_status === "Delivered" || e.delivery.dispatch_status === "Failed / Reschedule";
  const groups: Record<Tab, CachedEntry[]> = {
    today: entries.filter((e) => !isDone(e) && e.delivery.scheduled_date <= today),
    upcoming: entries.filter((e) => !isDone(e) && e.delivery.scheduled_date > today),
    done: entries.filter(isDone),
  };
  for (const g of Object.values(groups)) g.sort((a, b) => a.delivery.scheduled_date.localeCompare(b.delivery.scheduled_date) || (a.delivery.time_window ?? "").localeCompare(b.delivery.time_window ?? ""));

  return (
    <div>
      {/* ------------------------------------------------ offline / sync bar */}
      <div className="mb-4 grid gap-3 rounded-2xl border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SyncBadge state={state} pending={pending.length} />
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Switch checked={simulateOffline} onCheckedChange={setSimulateOffline} aria-label="Simulate Offline / Weak Signal" />
            Simulate Offline / Weak Signal
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          Last successful sync: <b className="text-foreground">{lastSync ? formatDateTime(lastSync) : "never"}</b>
          {lastPreload && <> · assignments saved on phone {formatDateTime(lastPreload)}</>}
          {!browserOnline && <> · <b className="text-destructive">phone reports no network</b></>}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="xl" variant="default" onClick={() => preload()} disabled={!online || !ready}>
            <CloudDownload aria-hidden /> Pre-Load Assignments for Offline Travel
          </Button>
          <Button size="xl" variant="outline" onClick={() => sync()} disabled={syncing || !ready}>
            {syncing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Sync Now {pending.length > 0 && `(${pending.length})`}
          </Button>
        </div>
        <DesignNote>
          Roads to Lantapan, Cabanglasan and Pangantucan lose signal. Every tap is saved on the phone first and labelled “Saved Locally”. Nothing claims “saved” until the server confirms it.
        </DesignNote>
      </div>

      {/* ------------------------------------------------- queue & conflicts */}
      {queue.length > 0 && (
        <section className="mb-4 grid gap-2" aria-label="Actions waiting to sync">
          {queue.map((q) => {
            const e = entries.find((x) => x.delivery.id === q.action.delivery_id);
            return (
              <div key={q.client_transaction_id} className={cn("rounded-xl border p-3 text-sm", q.state === "pending" ? "border-warning bg-warning-soft" : "border-destructive bg-danger-soft")}>
                <p className="font-semibold">
                  {e?.order.order_code ?? "Order"} · {labelOf(q.action)}
                  {q.state === "pending" && <span className="ml-2 font-bold text-warning">Saved Locally — Pending Sync</span>}
                  {q.state === "conflict" && <span className="ml-2 font-bold text-destructive">Sync Conflict</span>}
                  {q.state === "rejected" && <span className="ml-2 font-bold text-destructive">Not accepted by server</span>}
                </p>
                <p className="text-xs text-muted-foreground">Recorded {formatDateTime(q.action.queued_at)}{q.attempts > 0 && ` · ${q.attempts} sync attempt(s)`}</p>
                {q.message && <p className="mt-1">{q.message}</p>}
                {q.state !== "pending" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.state === "conflict" && (
                      <Button size="touch" variant="warning" onClick={async () => { await resolveConflict(dbRef.current!, q.client_transaction_id, "reapply"); await reload(); await sync(); }}>
                        Re-apply my action
                      </Button>
                    )}
                    <Button size="touch" variant="outline" onClick={async () => { await resolveConflict(dbRef.current!, q.client_transaction_id, "discard"); await reload(); await preload(true); }}>
                      Discard & use shop version
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* ---------------------------------------------------------------- tabs */}
      <div role="tablist" aria-label="Deliveries" className="mb-3 grid grid-cols-3 gap-1">
        {([["today", "Today"], ["upcoming", "Upcoming"], ["done", "Done + Failed"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn("h-14 rounded-xl border text-sm font-semibold", tab === id ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
            {label} <span className="font-black tabular-nums">({groups[id].length})</span>
          </button>
        ))}
      </div>

      {groups[tab].length === 0 ? (
        <EmptyState title={tab === "today" ? "No deliveries for today" : tab === "upcoming" ? "Nothing scheduled ahead" : "No finished trips yet"} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {groups[tab].map((e) => (
            <DeliveryCard key={e.delivery.id} entry={e} today={today}
              onStart={() => record(e, "start_trip")}
              onDelivered={() => setDialog({ kind: "delivered", entry: e })}
              onFailed={() => setDialog({ kind: "failed", entry: e })} />
          ))}
        </ul>
      )}

      <DeliveredDialog entry={dialog?.kind === "delivered" ? dialog.entry : null} online={online} onClose={() => setDialog(null)}
        onSubmit={async (amount, method, notes) => { const e = dialog!.entry; setDialog(null); await record(e, "delivered", { amount_collected: amount, payment_method: method, notes }); }} />
      <FailedDialog entry={dialog?.kind === "failed" ? dialog.entry : null} online={online} onClose={() => setDialog(null)}
        onSubmit={async (notes, touchUp) => { const e = dialog!.entry; setDialog(null); await record(e, "failed", { notes, needs_touch_up: touchUp }); }} />
    </div>
  );
}

function labelOf(a: DriverAction) {
  if (a.type === "start_trip") return "Start trip";
  if (a.type === "delivered") return `Delivered · cash ${formatPeso(a.amount_collected ?? 0)}`;
  return `Failed delivery${a.needs_touch_up ? " + touch-up" : ""}`;
}

function SyncBadge({ state, pending }: { state: SyncState; pending: number }) {
  const map = {
    synced: { cls: "bg-success text-success-foreground", icon: <Wifi className="size-4" />, text: "Online • Synced" },
    offline: { cls: "bg-warning text-warning-foreground", icon: <CloudOff className="size-4" />, text: `Offline • Saved Locally (${pending} pending)` },
    syncing: { cls: "bg-info text-info-foreground", icon: <Loader2 className="size-4 animate-spin" />, text: "Syncing..." },
    conflict: { cls: "bg-destructive text-destructive-foreground", icon: <AlertTriangle className="size-4" />, text: "Sync Conflict" },
  }[state];
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-bold", map.cls)}>
      {map.icon}{state === "offline" && pending === 0 ? "Offline • Nothing pending" : map.text}
    </span>
  );
}

function DeliveryCard({ entry: e, today, onStart, onDelivered, onFailed }: { entry: CachedEntry; today: string; onStart: () => void; onDelivered: () => void; onFailed: () => void }) {
  const d = e.delivery;
  const o = e.order;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.delivery_address}, ${o.municipality}, Bukidnon`)}`;
  return (
    <li className={cn("rounded-2xl border-2 bg-card p-4", d.dispatch_status === "Out for Delivery" && "border-info", d.dispatch_status === "Failed / Reschedule" && "border-destructive")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-black">{o.order_code}</span>
        <span className="rounded-full border px-2 py-0.5 text-xs font-bold">{d.dispatch_status}</span>
        {e.local_pending && <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-bold text-warning-foreground">Saved Locally</span>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {d.scheduled_date === today ? "Today" : formatDate(d.scheduled_date)} · {d.time_window} · <Truck className="inline size-4" aria-hidden /> {d.vehicle_type}
      </p>
      <p className="mt-2 text-lg font-semibold">{o.customer_name}</p>
      <p className="text-sm">{o.quantity} × {o.item_name} · {o.color_finish}</p>
      <p className="mt-1 flex gap-1.5 text-base"><MapPin className="mt-1 size-4 shrink-0" aria-hidden />{o.delivery_address}, <b>{o.municipality}</b></p>
      {o.special_instructions && <p className="mt-1 rounded-lg bg-muted p-2 text-sm whitespace-pre-line">{o.special_instructions}</p>}
      {d.failure_or_damage_notes && <p className="mt-1 text-sm text-destructive">{d.failure_or_damage_notes}</p>}

      <div className="mt-3 rounded-xl bg-foreground p-3 text-center text-background">
        <p className="text-xs font-semibold tracking-widest uppercase">Collect on delivery</p>
        <p className="text-3xl font-black tabular-nums">{formatPeso(o.collectible_on_delivery)}</p>
        <p className="text-xs opacity-80">balance {formatPeso(o.remaining_furniture_balance)} + delivery fee {o.delivery_fee === 0 ? "FREE" : formatPeso(o.delivery_fee)}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`tel:${o.customer_phone}`} className="flex h-12 items-center justify-center gap-2 rounded-lg border font-semibold"><Phone className="size-5" aria-hidden /> Call</a>
        <a href={maps} target="_blank" rel="noreferrer noopener" className="flex h-12 items-center justify-center gap-2 rounded-lg border font-semibold"><Navigation className="size-5" aria-hidden /> Map</a>
      </div>

      <div className="mt-2 grid gap-2">
        {d.dispatch_status === "Scheduled" && (o.down_payment_ok ? (
          <Button size="xl" onClick={onStart}><Truck aria-hidden /> Start Trip</Button>
        ) : (
          <p className="rounded-lg border border-warning bg-warning-soft p-2 text-sm font-semibold">Hold: 30% down payment not received and no owner approval yet. Call the shop before loading.</p>
        ))}
        {d.dispatch_status === "Out for Delivery" && (
          <>
            <Button size="xl" variant="success" onClick={onDelivered}><CheckCircle2 aria-hidden /> Mark Delivered &amp; Log Cash Collected</Button>
            <Button size="xl" variant="outline" onClick={onFailed}><XCircle aria-hidden /> Report Failed / Scratch Touch-Up</Button>
          </>
        )}
        {d.dispatch_status === "Scheduled" && <Button size="touch" variant="ghost" onClick={onFailed}>Can&apos;t go? Report failed / reschedule</Button>}
      </div>
    </li>
  );
}

function DeliveredDialog({ entry, online, onClose, onSubmit }: { entry: CachedEntry | null; online: boolean; onClose: () => void; onSubmit: (amount: number, method: "Cash" | "GCash / Bank Transfer", notes: string) => void }) {
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {entry && (
          <form className="grid gap-4" onSubmit={(ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            const amount = Number(fd.get("amount"));
            if (!Number.isFinite(amount) || amount < 0) { toast.error("Enter the amount collected (0 if none)."); return; }
            onSubmit(amount, fd.get("method") as "Cash" | "GCash / Bank Transfer", String(fd.get("notes") ?? ""));
          }}>
            <DialogHeader>
              <DialogTitle className="text-lg">Delivered {entry.order.order_code}</DialogTitle>
              <DialogDescription>Expected: <b className="text-foreground">{formatPeso(entry.order.collectible_on_delivery)}</b>. Enter what you actually received.</DialogDescription>
            </DialogHeader>
            <Field label="Amount collected (₱)" htmlFor="amount" required hint="If less than expected, the owner is alerted automatically.">
              <TextInput id="amount" name="amount" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={entry.order.collectible_on_delivery} className="text-xl font-bold" required />
            </Field>
            <Field label="Payment method" htmlFor="method">
              <NativeSelect id="method" name="method" defaultValue="Cash" options={["Cash", "GCash / Bank Transfer"]} />
            </Field>
            <Field label="Notes (optional)" htmlFor="dnotes"><TextInput id="dnotes" name="notes" placeholder="e.g. Received by daughter, Ana" /></Field>
            {!online && <p className="rounded-lg bg-warning-soft p-2 text-sm font-semibold">No signal: this will be Saved Locally and synced automatically when you are back online.</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="touch" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="success" size="touch">{online ? "Save delivery" : "Save on phone"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FailedDialog({ entry, online, onClose, onSubmit }: { entry: CachedEntry | null; online: boolean; onClose: () => void; onSubmit: (notes: string, touchUp: boolean) => void }) {
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {entry && (
          <form className="grid gap-4" onSubmit={(ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            const notes = String(fd.get("notes") ?? "").trim();
            if (notes.length < 5) { toast.error("Describe what happened so the shop can reschedule."); return; }
            onSubmit(notes, fd.get("touchup") === "on");
          }}>
            <DialogHeader>
              <DialogTitle className="text-lg">Report problem · {entry.order.order_code}</DialogTitle>
              <DialogDescription>The furniture returns to “Ready for Delivery” and the office reschedules.</DialogDescription>
            </DialogHeader>
            <Field label="What happened?" htmlFor="fnotes" required>
              <TextArea id="fnotes" name="notes" required placeholder="e.g. Customer not home; road flooded at the river crossing; scratch on left door." />
            </Field>
            <label className="flex items-center gap-3 rounded-lg border p-3 text-sm font-medium">
              <input type="checkbox" name="touchup" className="size-5" /> Needs painter touch-up / repair (scratch or damage)
            </label>
            {!online && <p className="rounded-lg bg-warning-soft p-2 text-sm font-semibold">No signal: this will be Saved Locally and synced when you are back online.</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="touch" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="danger" size="touch">{online ? "Send report" : "Save on phone"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
