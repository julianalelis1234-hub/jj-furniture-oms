import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { DomainError, fromPostgresMessage } from "@/lib/domain/errors";
import { LIVE_EVENT_COLUMNS, type LiveEvent } from "@/lib/realtime/events";
import type {
  NewOutboxRow,
  OutboxRow,
  ConsumeReviewResult,
  CustomerAccount,
  DeliveryAssignment,
  NotificationLog,
  Order,
  OrderConfirmation,
  OrderException,
  Payment,
  Profile,
  SpecRevision,
  StatusHistory,
  WorkshopOrder,
} from "@/lib/domain/types";
import type {
  AddRevisionInput,
  AddRevisionResult,
  AcceptRevisionInput,
  AcceptRevisionResult,
  DataStore,
  Insert,
  NewOrderRow,
  OrderPatch,
  UpdateResult,
} from "./store";

const NUMERIC_ORDER_FIELDS = [
  "furniture_price",
  "standard_down_payment_due",
  "remaining_furniture_balance",
  "delivery_fee",
  "collectible_on_delivery",
  "width_cm",
  "height_cm",
  "depth_cm",
] as const;

function normOrder<T extends Partial<Order>>(o: T): T {
  for (const f of NUMERIC_ORDER_FIELDS) if (o[f] !== undefined && o[f] !== null) (o as Record<string, unknown>)[f] = Number(o[f]);
  return o;
}
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const normRevision = (r: SpecRevision): SpecRevision => ({
  ...r,
  width_cm: numOrNull(r.width_cm),
  height_cm: numOrNull(r.height_cm),
  depth_cm: numOrNull(r.depth_cm),
  quoted_furniture_price: numOrNull(r.quoted_furniture_price),
  quoted_delivery_fee: numOrNull(r.quoted_delivery_fee),
});
const normConfirmation = (c: OrderConfirmation): OrderConfirmation => ({
  ...c,
  accepted_furniture_price: Number(c.accepted_furniture_price),
  accepted_delivery_fee: Number(c.accepted_delivery_fee),
  accepted_total_amount: Number(c.accepted_total_amount),
});
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
 * already-authorized operations (customer order details after the database
 * confirmed ownership, review links, craftsman workflow updates, notification logging).
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
    // staff only: customer logins (role 'customer') never appear in staff lists
    const { data, error } = await this.db.from("profiles").select("*").neq("role", "customer").order("full_name");
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
  // ------------------------------------------------- email outbox (008)
  // Service role only (RLS on, no policies). Call these on elevated().
  async enqueueOutbox(row: NewOutboxRow) {
    const { data, error } = await this.db.from("notification_outbox").insert(row).select("*").single();
    if (!error) return { row: data as OutboxRow, duplicate: false };
    if (error.code === "23505") {
      const { data: existing, error: e2 } = await this.db.from("notification_outbox").select("*").eq("idempotency_key", row.idempotency_key).single();
      if (e2) fail(e2);
      return { row: existing as OutboxRow, duplicate: true };
    }
    fail(error);
  }
  async claimOutbox(limit: number, leaseSeconds: number, onlyId?: string) {
    const { data, error } = await this.db.rpc("claim_notification_outbox", { p_limit: limit, p_lease_seconds: leaseSeconds, p_only_id: onlyId ?? null });
    if (error) fail(error);
    return (data ?? []) as OutboxRow[];
  }
  private async leaseRpc(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) fail(error);
    return data === true;
  }
  updateOutboxPayload(id: string, lease: string, encryptedPayload: string) {
    return this.leaseRpc("update_notification_outbox_payload", { p_id: id, p_lease: lease, p_encrypted_payload: encryptedPayload });
  }
  completeOutbox(id: string, lease: string, providerMessageId: string) {
    return this.leaseRpc("complete_notification_outbox", { p_id: id, p_lease: lease, p_provider_message_id: providerMessageId });
  }
  failOutbox(id: string, lease: string, error: string, permanent: boolean, retrySeconds: number) {
    return this.leaseRpc("fail_notification_outbox", { p_id: id, p_lease: lease, p_error: error, p_permanent: permanent, p_retry_seconds: Math.round(retrySeconds) });
  }
  releaseOutbox(id: string, lease: string, retrySeconds: number) {
    return this.leaseRpc("release_notification_outbox", { p_id: id, p_lease: lease, p_retry_seconds: Math.round(retrySeconds) });
  }
  async scrubOutbox() {
    const { data, error } = await this.db.rpc("scrub_notification_outbox");
    if (error) fail(error);
    return Number(data ?? 0);
  }
  async listOutbox(filter?: { orderId?: string }) {
    let q = this.db.from("notification_outbox").select("*").order("created_at", { ascending: false }).limit(200);
    if (filter?.orderId) q = q.eq("order_id", filter.orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as OutboxRow[];
  }
  async getOutbox(id: string) {
    const { data, error } = await this.db.from("notification_outbox").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return (data as OutboxRow | null) ?? null;
  }
  async reviewTokenState(tokenId: string) {
    const { data, error } = await this.db.from("quote_review_tokens").select("token_hash, consumed_at, invalidated_at, expires_at").eq("token_id", tokenId).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const t = data as { token_hash: string; consumed_at: string | null; invalidated_at: string | null; expires_at: string };
    return { usable: !t.consumed_at && !t.invalidated_at && Date.parse(t.expires_at) > Date.now(), token_hash: t.token_hash };
  }
  async hitRateLimit(bucket: string, windowSeconds: number, max: number) {
    const { data, error } = await this.db.rpc("hit_rate_limit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_max: max });
    if (error) fail(error);
    return data === true;
  }

  // ------------------------------------------------- live-sync feed (007)
  // With the user's JWT the RLS policies on order_live_events decide visibility.
  async listLiveEvents(afterId: number, limit: number) {
    const { data, error } = await this.db.from("order_live_events").select(LIVE_EVENT_COLUMNS)
      .gt("id", afterId).order("id", { ascending: true }).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as LiveEvent[]).map((e) => ({ ...e, id: Number(e.id) }));
  }
  async latestLiveEventId() {
    const { data, error } = await this.db.from("order_live_events").select("id").order("id", { ascending: false }).limit(1);
    if (error) fail(error);
    return Number(data?.[0]?.id ?? 0);
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
    return (data as WorkshopOrder[]).map((w) => ({
      ...w,
      width_cm: numOrNull(w.width_cm),
      height_cm: numOrNull(w.height_cm),
      depth_cm: numOrNull(w.depth_cm),
    }));
  }

  async listRevisions(orderId: string) {
    const { data, error } = await this.db
      .from("order_specification_revisions")
      .select("*")
      .eq("order_id", orderId)
      .order("revision_number");
    if (error) fail(error);
    return (data as SpecRevision[]).map(normRevision);
  }
  /** public.add_spec_revision(): locks the order row (SELECT ... FOR UPDATE) and numbers revisions atomically. */
  async addSpecRevision(input: AddRevisionInput): Promise<AddRevisionResult> {
    const { data, error } = await this.db.rpc("add_spec_revision", {
      p_order_id: input.order_id,
      p_type: input.type,
      p_spec: input.spec,
      p_expected_revision: input.expected_revision,
      p_created_by_role: input.created_by_role,
      p_created_by_id: input.created_by_id,
      p_preview_config: input.preview_config ?? {},
      p_quote_validity_days: input.quote_validity_days ?? 7,
      p_paper_slip_number: input.paper_slip_number ?? null,
      p_estimated_completion_date: input.estimated_completion_date ?? null,
    });
    if (error) fail(error);
    return data as AddRevisionResult;
  }
  /** public.accept_order_revision(): row-locked, stale/expiry/amount-checked, idempotent acceptance. */
  async acceptOrderRevision(input: AcceptRevisionInput): Promise<AcceptRevisionResult> {
    const { data, error } = await this.db.rpc("accept_order_revision", {
      p_order_id: input.order_id,
      p_revision_id: input.revision_id,
      p_expected_revision_number: input.expected_revision_number,
      p_accepted_furniture_price: input.accepted_furniture_price,
      p_accepted_delivery_fee: input.accepted_delivery_fee,
      p_accepted_total_amount: input.accepted_total_amount,
      p_client_idempotency_key: input.client_idempotency_key,
      p_method: input.method,
      p_confirmed_by_name: input.confirmed_by_name,
      p_recorded_by: input.recorded_by,
      p_new_order_code: input.new_order_code,
      p_payment_plan: input.payment_plan,
      p_payment_method: input.payment_method,
    });
    if (error) fail(error);
    return data as AcceptRevisionResult;
  }

  async listConfirmations(orderId?: string) {
    let q = this.db.from("order_confirmations").select("*").order("version_number");
    if (orderId) q = q.eq("order_id", orderId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data as OrderConfirmation[]).map(normConfirmation);
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

  // ------------------------------------------------ customer email auth (005)
  // The token / linking functions are executable by service_role only: call these on elevated().
  async issueReviewToken(input: { order_id: string; revision_id: string; token_hash: string; ttl_hours: number }) {
    const { data, error } = await this.db.rpc("issue_quote_review_token", {
      p_order_id: input.order_id, p_revision_id: input.revision_id, p_token_hash: input.token_hash, p_ttl_hours: input.ttl_hours,
    });
    if (error) fail(error);
    return data as { token_id: string; expires_at: string; sent_to_email: string };
  }
  async consumeReviewToken(tokenHash: string) {
    const { data, error } = await this.db.rpc("consume_quote_review_token", { p_token_hash: tokenHash });
    if (error) fail(error);
    return data as ConsumeReviewResult;
  }
  async linkCustomerAccount(orderId: string, userId: string) {
    const { data, error } = await this.db.rpc("link_customer_account", { p_order_id: orderId, p_user_id: userId });
    if (error) fail(error);
    return data as { linked: boolean; already: boolean };
  }
  async claimCustomerOrders(userId: string) {
    const { data, error } = await this.db.rpc("claim_customer_orders", { p_user_id: userId });
    if (error) fail(error);
    return Number(data ?? 0);
  }
  async listCustomerOrders(userId: string) {
    const { data, error } = await this.db.from("orders").select("*").eq("customer_user_id", userId).order("created_at", { ascending: false });
    if (error) fail(error);
    return (data as Order[]).map(normOrder);
  }
  async findCustomerAccountByEmail(email: string) {
    const { data, error } = await this.db.from("profiles").select("id, email, full_name, is_active, created_at")
      .eq("role", "customer").eq("email", email.trim().toLowerCase()).maybeSingle();
    if (error) fail(error);
    return (data as CustomerAccount | null) ?? null;
  }
  async getCustomerAccount(id: string) {
    const { data, error } = await this.db.from("profiles").select("id, email, full_name, is_active, created_at")
      .eq("role", "customer").eq("id", id).maybeSingle();
    if (error) fail(error);
    return (data as CustomerAccount | null) ?? null;
  }
  async emailBelongsToStaff(email: string) {
    const { data, error } = await this.db.from("profiles").select("id").neq("role", "customer").eq("email", email.trim().toLowerCase()).limit(1);
    if (error) fail(error);
    return (data ?? []).length > 0;
  }
  async insertCustomerProfile(row: { id: string; email: string; full_name: string }) {
    const { data, error } = await this.db.from("profiles")
      .insert({ id: row.id, email: row.email.trim().toLowerCase(), full_name: row.full_name, role: "customer", is_active: true })
      .select("id, email, full_name, is_active, created_at").single();
    if (error) fail(error);
    return data as CustomerAccount;
  }
}
