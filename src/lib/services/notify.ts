import { isDemoMode } from "@/lib/config";
import { DomainError } from "@/lib/domain/errors";
import { PH_PHONE } from "@/lib/domain/validation";
import type { DataStore } from "@/lib/data/store";
import type { NotificationLog, NotificationStatus, Order } from "@/lib/domain/types";

export interface SmsProvider {
  readonly name: string;
  send(phone: string, body: string): Promise<{ status: NotificationStatus; detail?: string }>;
}

/** Demo-only simulation: numbers that are not valid PH mobiles, or known-unreachable, fail. */
export const DEMO_UNREACHABLE = new Set(["09000000999"]);
export const simulatedSms: SmsProvider = {
  name: "simulated (demo)",
  async send(phone) {
    if (!PH_PHONE.test(phone) || DEMO_UNREACHABLE.has(phone)) return { status: "Failed", detail: "Number not reachable" };
    return { status: "Sent" };
  },
};

/** Semaphore (semaphore.co) — a Philippine SMS gateway. Used only if SEMAPHORE_API_KEY is set. */
export const semaphoreSms = (apiKey: string, sender?: string): SmsProvider => ({
  name: "semaphore",
  async send(phone, body) {
    try {
      const res = await fetch("https://api.semaphore.co/api/v4/messages", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ apikey: apiKey, number: phone, message: body, ...(sender ? { sendername: sender } : {}) }),
      });
      return res.ok ? { status: "Sent" } : { status: "Failed", detail: `Gateway HTTP ${res.status}` };
    } catch {
      return { status: "Failed", detail: "Gateway unreachable" };
    }
  },
});

/** No gateway configured in production: log as Pending so staff send it by Messenger/phone. */
export const manualQueue: SmsProvider = {
  name: "manual",
  async send() {
    return { status: "Pending", detail: "No SMS gateway configured — send manually" };
  },
};

/** How customer SMS is delivered right now — shown in the UI so a demo never implies real texts were sent. */
export function smsMode(): "gateway" | "simulated" | "manual" {
  if (process.env.SEMAPHORE_API_KEY) return "gateway";
  return isDemoMode() ? "simulated" : "manual";
}
export const SMS_SIMULATED_NOTE = "(simulated — no SMS gateway connected)";

export function defaultProvider(): SmsProvider {
  const key = process.env.SEMAPHORE_API_KEY;
  if (key) return semaphoreSms(key, process.env.SEMAPHORE_SENDER_NAME);
  return isDemoMode() ? simulatedSms : manualQueue;
}

/**
 * Sends and logs a customer update. Best-effort by design: the order action
 * that triggered it has already been saved, so a gateway or logging failure
 * must never turn it into an error. Office roles may write notifications under
 * RLS; field roles (driver/craftsman) fall back to the elevated store.
 */
export async function notifyCustomer(
  store: DataStore,
  order: Pick<Order, "id" | "customer_phone">,
  body: string,
  provider: SmsProvider = defaultProvider(),
): Promise<NotificationLog | null> {
  try {
    const result = await provider.send(order.customer_phone, body);
    const row = {
      order_id: order.id,
      recipient_phone: order.customer_phone,
      channel: "SMS" as const,
      message_body: body,
      delivery_status: result.status,
      created_at: new Date().toISOString(),
    };
    try {
      return await store.insertNotification(row);
    } catch (e) {
      if (e instanceof DomainError && e.code === "FORBIDDEN") return await store.elevated().insertNotification(row);
      throw e;
    }
  } catch (e) {
    console.error("[notify] customer update not logged:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function retryNotification(
  store: DataStore,
  id: string,
  phoneOverride?: string,
  provider: SmsProvider = defaultProvider(),
): Promise<NotificationLog> {
  const log = (await store.listNotifications()).find((n) => n.id === id);
  if (!log) throw new Error("Notification not found");
  const phone = phoneOverride?.trim() || log.recipient_phone || "";
  const result = await provider.send(phone, log.message_body);
  return store.updateNotification(id, { delivery_status: result.status, recipient_phone: phone, created_at: new Date().toISOString() });
}
