import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DriverAction, DriverActionResult, ManifestEntry } from "@/lib/services/deliveries";

export type QueueState = "pending" | "conflict" | "rejected";

export interface QueueItem {
  client_transaction_id: string;
  action: DriverAction;
  state: QueueState;
  message?: string;
  server_current?: { version: number; status: string; collectible_on_delivery: number };
  attempts: number;
  created_at: string;
  /** strictly increasing replay order (timestamps can tie within one millisecond) */
  seq: number;
}

export interface CachedEntry extends ManifestEntry {
  /** true while a local action for this delivery has not reached the server */
  local_pending?: boolean;
}

interface DriverDB extends DBSchema {
  manifest: { key: string; value: CachedEntry };
  sync_queue: { key: string; value: QueueItem; indexes: { by_seq: number } };
  meta: { key: string; value: unknown };
}

export const DB_NAME = "jj-oms-driver";

export function openDriverDb(name = DB_NAME): Promise<IDBPDatabase<DriverDB>> {
  return openDB<DriverDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore("manifest", { keyPath: "delivery.id" });
      const q = db.createObjectStore("sync_queue", { keyPath: "client_transaction_id" });
      q.createIndex("by_seq", "seq");
      db.createObjectStore("meta");
    },
  });
}
export type DriverDb = IDBPDatabase<DriverDB>;

const TARGET_STATUS = { start_trip: "Out for Delivery", delivered: "Delivered", failed: "Ready for Delivery" } as const;
const TARGET_DISPATCH = { start_trip: "Out for Delivery", delivered: "Delivered", failed: "Failed / Reschedule" } as const;

/**
 * Replaces cached assignments with a fresh server manifest, but keeps the
 * optimistic local state of anything that still has queued actions.
 */
export async function saveManifest(db: DriverDb, entries: ManifestEntry[], driverId: string): Promise<void> {
  const queue = await listQueue(db);
  const pendingDeliveries = new Set(queue.map((q) => q.action.delivery_id));
  const tx = db.transaction(["manifest", "meta"], "readwrite");
  const manifest = tx.objectStore("manifest");
  const existing = await manifest.getAll();
  for (const e of existing) if (!pendingDeliveries.has(e.delivery.id)) await manifest.delete(e.delivery.id);
  for (const e of entries) {
    if (pendingDeliveries.has(e.delivery.id)) continue;
    await manifest.put({ ...e, local_pending: false });
  }
  await tx.objectStore("meta").put(driverId, "driver_id");
  await tx.objectStore("meta").put(new Date().toISOString(), "last_preload");
  await tx.done;
}

export async function getManifest(db: DriverDb): Promise<CachedEntry[]> {
  return db.getAll("manifest");
}

export async function getMeta<T>(db: DriverDb, key: string): Promise<T | undefined> {
  return (await db.get("meta", key)) as T | undefined;
}
export async function setMeta(db: DriverDb, key: string, value: unknown) {
  await db.put("meta", value, key);
}

/** Saves an action locally first (works fully offline) and updates the cached view optimistically. */
export async function enqueueAction(db: DriverDb, action: DriverAction): Promise<QueueItem> {
  const last = await db.getAllFromIndex("sync_queue", "by_seq");
  const seq = Math.max(Date.now() * 1000, (last.at(-1)?.seq ?? 0) + 1);
  const item: QueueItem = {
    seq,
    client_transaction_id: action.client_transaction_id,
    action,
    state: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
  };
  const tx = db.transaction(["sync_queue", "manifest"], "readwrite");
  await tx.objectStore("sync_queue").put(item);
  const entry = await tx.objectStore("manifest").get(action.delivery_id);
  if (entry) {
    entry.order.status = TARGET_STATUS[action.type];
    entry.delivery.dispatch_status = TARGET_DISPATCH[action.type];
    if (action.type === "failed") entry.delivery.failure_or_damage_notes = action.notes ?? null;
    entry.local_pending = true;
    await tx.objectStore("manifest").put(entry);
  }
  await tx.done;
  return item;
}

export async function listQueue(db: DriverDb): Promise<QueueItem[]> {
  return db.getAllFromIndex("sync_queue", "by_seq");
}

export type SendFn = (action: DriverAction) => Promise<DriverActionResult>;

export interface FlushSummary {
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  networkError: boolean;
  remaining: number;
}

/**
 * Sends pending actions one at a time, oldest first.
 *  - applied/duplicate: removed from the queue; later actions on the same
 *    order that were queued against the same base version are rebased onto
 *    the server's new version (they are our own sequential changes).
 *  - conflict: kept with the server's current state for the driver to review;
 *    later actions on that order are held back.
 *  - network failure: stop and keep everything for the next attempt.
 */
export async function flushQueue(db: DriverDb, send: SendFn): Promise<FlushSummary> {
  const summary: FlushSummary = { applied: 0, duplicates: 0, conflicts: 0, rejected: 0, networkError: false, remaining: 0 };
  const blockedOrders = new Set<string>();
  const items = await listQueue(db);

  for (const item of items) {
    if (item.state !== "pending") {
      blockedOrders.add(item.action.order_id);
      continue;
    }
    if (blockedOrders.has(item.action.order_id)) continue;

    let result: DriverActionResult;
    try {
      result = await send(item.action);
    } catch {
      summary.networkError = true;
      await db.put("sync_queue", { ...item, attempts: item.attempts + 1 });
      break;
    }

    if (result.status === "applied" || result.status === "duplicate") {
      summary[result.status === "applied" ? "applied" : "duplicates"]++;
      const tx = db.transaction(["sync_queue", "manifest"], "readwrite");
      const q = tx.objectStore("sync_queue");
      await q.delete(item.client_transaction_id);
      for (const later of await q.getAll()) {
        if (later.action.order_id === item.action.order_id && later.action.base_version === item.action.base_version) {
          later.action.base_version = result.order_version;
          await q.put(later);
        }
      }
      const entry = await tx.objectStore("manifest").get(item.action.delivery_id);
      if (entry) {
        entry.order.version = result.order_version;
        entry.order.status = result.order_status;
        entry.local_pending = (await q.getAll()).some((x) => x.action.delivery_id === item.action.delivery_id);
        await tx.objectStore("manifest").put(entry);
      }
      await tx.done;
      // keep in-memory copies of later items in sync with the rebase
      for (const later of items) {
        if (later !== item && later.action.order_id === item.action.order_id && later.action.base_version === item.action.base_version) {
          later.action.base_version = result.order_version;
        }
      }
    } else if (result.status === "conflict") {
      summary.conflicts++;
      blockedOrders.add(item.action.order_id);
      await db.put("sync_queue", { ...item, state: "conflict", message: result.message, server_current: result.current, attempts: item.attempts + 1 });
    } else {
      summary.rejected++;
      blockedOrders.add(item.action.order_id);
      await db.put("sync_queue", { ...item, state: "rejected", message: result.message, attempts: item.attempts + 1 });
    }
  }

  summary.remaining = (await listQueue(db)).length;
  if (!summary.networkError && summary.remaining === 0) await setMeta(db, "last_sync", new Date().toISOString());
  else if (!summary.networkError && summary.applied + summary.duplicates > 0) await setMeta(db, "last_sync", new Date().toISOString());
  return summary;
}

/** Driver decision after reviewing a conflict: re-apply on top of the current server version, or drop it. */
export async function resolveConflict(db: DriverDb, txn: string, decision: "reapply" | "discard"): Promise<void> {
  const item = await db.get("sync_queue", txn);
  if (!item) return;
  if (decision === "discard") {
    await db.delete("sync_queue", txn);
    return;
  }
  const version = item.server_current?.version ?? item.action.base_version;
  await db.put("sync_queue", {
    ...item,
    state: "pending",
    message: undefined,
    action: { ...item.action, base_version: version },
  });
}
