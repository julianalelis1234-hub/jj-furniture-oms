"use server";

import { refresh } from "next/cache";
import { isDemoMode } from "@/lib/config";
import type { MemoryStore } from "@/lib/data/memory-store";
import { processOutbox } from "@/lib/email/outbox";
import { getPublicStore } from "@/lib/server/context";
import { getCustomerAuth } from "@/lib/server/customer-auth";

/**
 * DEMO / LOCAL ONLY: there is no scheduler on a developer PC, so this sends every
 * queued email now (retries included). Refused outside demo mode; production uses
 * the cron-secret worker at /api/notifications/process.
 */
export async function sendQueuedEmailsNowAction() {
  if (!isDemoMode()) return { ok: false as const, message: "Not available." };
  const store = await getPublicStore();
  if (store.kind === "memory")
    for (const o of (store as MemoryStore).t.notification_outbox)
      if (!o.is_permanent_failure && (o.delivery_status === "failed" || o.delivery_status === "pending")) o.next_retry_at = new Date().toISOString();
  const s = await processOutbox(store, { auth: await getCustomerAuth() }, { limit: 50 });
  refresh();
  return { ok: true as const, message: `Provider: ${s.provider} · sent ${s.sent} · still retrying ${s.retrying} · failed ${s.failed}` };
}
