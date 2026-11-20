import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { DomainError, fromPostgresMessage } from "@/lib/domain/errors";
import type {
  CustomerTrack,
  DeliveryAssignment,
  NotificationLog,
  Order,
  OrderConfirmation,
  OrderException,
  Payment,
  PinResult,
  Profile,
  StatusHistory,
  WorkshopOrder,
} from "@/lib/domain/types";
import type { DataStore, Insert, NewOrderRow, OrderPatch, UpdateResult } from "./store";

const NUMERIC_ORDER_FIELDS = [
  "furniture_price",
  "standard_down_payment_due",
  "remaining_furniture_balance",
  "delivery_fee",
  "collectible_on_delivery",
] as const;

function normOrder<T extends Partial<Order>>(o: T): T {
  for (const f of NUMERIC_ORDER_FIELDS) if (o[f] !== undefined && o[f] !== null) (o as Record<string, unknown>)[f] = Number(o[f]);
  return o;
}
const normPayment = (p: Payment): Payment => ({ ...p, amount: Number(p.amount) });
const normDelivery = (d: DeliveryAssignment): DeliveryAssignment => ({
  ...d,
  delivery_fee: Number(d.delivery_fee),
  expected_collectible_amount: Number(d.expected_collectible_amount),
});

function fail(error: PostgrestError): never {
  throw fromPostgresMessage(error.message, error.code);
}

/**
 * Supabase implementation. `db` is the request-scoped client: for an
 * authenticated staff member it carries their JWT, so every read and write is
 * filtered by the RLS policies in 001_init.sql. `admin` (service role) is only
 * reachable through elevated(), which services call for narrowly-scoped,
 * already-authorized operations (customer portal after PIN verification,
 * craftsman workflow updates, notification logging).
 */
export class SupabaseStore implements DataStore {
  readonly kind = "supabase" as const;
  constructor(
    private db: SupabaseClient,
    private admin: SupabaseClient | null,
  ) {}

  elevated(): DataStore {
    if (!this.admin) throw new DomainError("BACKEND", "Server is missing SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseStore(this.admin, this.admin);
  }

  async listProfiles() {
    const { data, error } = await this.db.from("profiles").select("*").order("full_name");
    if (error) fail(error);
    return data as Profile[];
  }

  async listOrders() {
    const { data, error } = await this.db.from("orders").select("*").order("priority_rank").order("created_at");
    if (error) fail(error);
    return (data as Order[]).map(normOrder);
  }
  async getOrder(id: string) {
    const { data, error } = await this.db.from("orders").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? normOrder(data as Order) : null;
  }
  async getOrderByCode(code: string) {
    const { data, error } = await this.db.from("orders").select("*").eq("order_code", code.trim().toUpperCase()).maybeSingle();
    if (error) fail(error);
    return data ? normOrder(data as Order) : null;
  }
  async insertOrder(row: NewOrderRow) {
    const { data, error } = await this.db.from("orders").insert(row).select("*").single();
    if (error) fail(error);
    return normOrder(data as Order);
  }
  async updateOrder(id: string, patch: OrderPatch, expectedVersion?: number): Promise<UpdateResult> {
    let q = this.db.from("orders").update(patch).eq("id", id);
    if (expectedVersion !== undefined) q = q.eq("version", expectedVersion);
    const { data, error } = await q.select("*");
    if (error) fail(error);
    if (data && data.length === 1) return { ok: true, order: normOrder(data[0] as Order) };
    const current = await this.getOrder(id);
    if (!current) throw new DomainError("NOT_FOUND", "Order not found or not visible to you.");
    if (expectedVersion !== undefined && current.version !== expectedVersion) return { ok: false, reason: "conflict", current };
    throw new DomainError("FORBIDDEN", "You do not have permission to update this order.");
  }
  async listWorkshopOrders() {
    const { data, error } = await this.db.rpc("workshop_orders");
    if (error) fail(error);
    return data as WorkshopOrder[];
  }

  async listConfirmations(orderId?: string) {
    let q = this.db.from("order_confirmations").select("*").order("version_number");
    if (orderId) q = q.eq("order_id", orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return data as OrderConfirmation[];
  }
  async insertConfirmation(row: Insert<OrderConfirmation>) {
    const { data, error } = await this.db.from("order_confirmations").insert(row).select("*").single();
    if (error) fail(error);
    return data as OrderConfirmation;
  }

  async listPayments(orderId?: string) {
    let q = this.db.from("payments").select("*").order("paid_at");
    if (orderId) q = q.eq("order_id", orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data as Payment[]).map(normPayment);
  }
  async insertPayment(row: Insert<Payment>) {
    const { data, error } = await this.db.from("payments").insert(row).select("*").single();
    if (error) {
      if (error.code === "23505" && error.message.includes("client_transaction_id")) {
        const { data: existing, error: e2 } = await this.db
          .from("payments")
          .select("*")
          .eq("client_transaction_id", row.client_transaction_id)
          .single();
        if (e2) fail(e2);
        return { payment: normPayment(existing as Payment), duplicate: true };
      }
      fail(error);
    }
    return { payment: normPayment(data as Payment), duplicate: false };
  }
  async updatePayment(id: string, patch: Partial<Payment>) {
    const { data, error } = await this.db.from("payments").update(patch).eq("id", id).select("*").single();
    if (error) fail(error);
    return normPayment(data as Payment);
  }

  async listHistory(orderId?: string) {
    let q = this.db.from("order_status_history").select("*").order("changed_at", { ascending: false });
    if (orderId) q = q.eq("order_id", orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return data as StatusHistory[];
  }
  async findHistoryByTransaction(txn: string) {
    const { data, error } = await this.db.from("order_status_history").select("*").eq("client_transaction_id", txn).maybeSingle();
    if (error) fail(error);
    return (data as StatusHistory) ?? null;
  }
  async insertHistory(row: Insert<StatusHistory>) {
    const { data, error } = await this.db.from("order_status_history").insert(row).select("*").single();
    if (error) fail(error);
    return data as StatusHistory;
  }

  async listDeliveries(filter?: { driverId?: string; orderId?: string }) {
    let q = this.db.from("delivery_assignments").select("*").order("scheduled_date");
    if (filter?.driverId) q = q.eq("driver_id", filter.driverId);
    if (filter?.orderId) q = q.eq("order_id", filter.orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data as DeliveryAssignment[]).map(normDelivery);
  }
  async insertDelivery(row: Insert<DeliveryAssignment>) {
    const { data, error } = await this.db.from("delivery_assignments").insert(row).select("*").single();
    if (error) {
      if (error.message.includes("delivery_assignments_one_active"))
        throw new DomainError("VALIDATION", "This order already has an active delivery assignment.");
      fail(error);
    }
    return normDelivery(data as DeliveryAssignment);
  }
  async updateDelivery(id: string, patch: Partial<DeliveryAssignment>) {
    const { data, error } = await this.db.from("delivery_assignments").update(patch).eq("id", id).select("*").single();
    if (error) fail(error);
    return normDelivery(data as DeliveryAssignment);
  }

  async listExceptions(orderId?: string) {
    let q = this.db.from("order_exceptions_and_repairs").select("*").order("created_at", { ascending: false });
    if (orderId) q = q.eq("order_id", orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return data as OrderException[];
  }
  async insertException(row: Insert<OrderException>) {
    const { data, error } = await this.db.from("order_exceptions_and_repairs").insert(row).select("*").single();
    if (error) fail(error);
    return data as OrderException;
  }
  async updateException(id: string, patch: Partial<OrderException>) {
    const { data, error } = await this.db.from("order_exceptions_and_repairs").update(patch).eq("id", id).select("*").single();
    if (error) fail(error);
    return data as OrderException;
  }

  async listNotifications(orderId?: string) {
    let q = this.db.from("notifications").select("*").order("created_at", { ascending: false });
    if (orderId) q = q.eq("order_id", orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return data as NotificationLog[];
  }
  async insertNotification(row: Insert<NotificationLog>) {
    const { data, error } = await this.db.from("notifications").insert(row).select("*").single();
    if (error) fail(error);
    return data as NotificationLog;
  }
  async updateNotification(id: string, patch: Partial<NotificationLog>) {
    const { data, error } = await this.db.from("notifications").update(patch).eq("id", id).select("*").single();
    if (error) fail(error);
    return data as NotificationLog;
  }

  async customerTrack(orderCode: string) {
    const { data, error } = await this.db.rpc("customer_track", { p_order_code: orderCode });
    if (error) fail(error);
    return (data as CustomerTrack) ?? null;
  }
  async customerVerifyPin(orderCode: string, pin: string, clientKey: string) {
    const { data, error } = await this.db.rpc("customer_verify_pin", {
      p_order_code: orderCode,
      p_pin: pin,
      p_client_key: clientKey,
    });
    if (error) fail(error);
    return data as PinResult;
  }
}
