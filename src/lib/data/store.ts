import type { FurnitureSpec } from "@/lib/domain/furniture";
import type {
  ConfirmationMethod,
  CustomerTrack,
  DeliveryAssignment,
  NotificationLog,
  Order,
  OrderConfirmation,
  OrderException,
  Payment,
  PinResult,
  Profile,
  RevisionType,
  SpecRevision,
  StatusHistory,
  WorkshopOrder,
} from "@/lib/domain/types";

export type ComputedOrderFields =
  | "id"
  | "standard_down_payment_due"
  | "remaining_furniture_balance"
  | "collectible_on_delivery"
  | "version"
  | "created_at"
  | "updated_at"
  | "current_revision"
  | "approved_revision_number"
  | "spec_preview_config"
  | "is_legacy_incomplete";

export type NewOrderRow = Omit<Order, ComputedOrderFields | "order_origin" | "client_request_key"> & {
  is_legacy_incomplete?: boolean;
  order_origin?: Order["order_origin"];
  client_request_key?: string | null;
};

/** A proposed specification (+ quote for shop revisions). */
export interface SpecInput extends FurnitureSpec {
  quoted_furniture_price?: number;
  quoted_delivery_fee?: number;
}

export interface AddRevisionInput {
  order_id: string;
  type: Exclude<RevisionType, "final_approved">;
  spec: SpecInput;
  /** the revision the editor was looking at (optimistic check); null/0 for revision 1 */
  expected_revision: number | null;
  created_by_role: string;
  created_by_id: string | null;
  preview_config?: Record<string, unknown>;
  /** shop quotations: validity (QUOTE_VALIDITY_DAYS), and the slip/date when quoting a customer request */
  quote_validity_days?: number;
  paper_slip_number?: string | null;
  estimated_completion_date?: string | null;
}
export interface AddRevisionResult {
  revision_id: string;
  revision_number: number;
  revision_type: RevisionType;
  changed_fields: Record<string, { from: unknown; to: unknown }>;
  quoted_at: string | null;
  expires_at: string | null;
}

/** accept_order_revision(): atomic acceptance of the exact specification AND quotation. */
export interface AcceptRevisionInput {
  order_id: string;
  revision_id: string;
  expected_revision_number: number;
  accepted_furniture_price: number;
  accepted_delivery_fee: number;
  accepted_total_amount: number;
  client_idempotency_key: string;
  method: ConfirmationMethod;
  confirmed_by_name: string;
  recorded_by: string | null;
  new_order_code: string | null;
}
export interface AcceptRevisionResult {
  confirmation_id: string;
  revision_id: string;
  revision_number: number;
  /** true when the idempotency key was already processed (no new row) */
  duplicate: boolean;
}
export type OrderPatch = Partial<Omit<Order, ComputedOrderFields | "id">>;

export type UpdateResult = { ok: true; order: Order } | { ok: false; reason: "conflict"; current: Order };

export type Insert<T extends { id: string }> = Omit<T, "id"> & { id?: string };

/**
 * The data-access contract shared by the in-memory demo store and the
 * Supabase store. Business rules that the database enforces (finance engine,
 * state machine, versioning, uniqueness) are enforced identically by both.
 */
export interface DataStore {
  readonly kind: "memory" | "supabase";

  listProfiles(): Promise<Profile[]>;

  listOrders(): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  getOrderByCode(code: string): Promise<Order | null>;
  insertOrder(row: NewOrderRow): Promise<Order>;
  /** Optimistic concurrency: when expectedVersion is given and stale, returns a conflict. */
  updateOrder(id: string, patch: OrderPatch, expectedVersion?: number): Promise<UpdateResult>;
  listWorkshopOrders(): Promise<WorkshopOrder[]>;

  /** Specification revisions — immutable; created only through addSpecRevision (row-locked in Postgres). */
  listRevisions(orderId: string): Promise<SpecRevision[]>;
  addSpecRevision(input: AddRevisionInput): Promise<AddRevisionResult>;
  /** Customer acceptance of one exact revision + quotation; moves the order to Confirmed atomically. */
  acceptOrderRevision(input: AcceptRevisionInput): Promise<AcceptRevisionResult>;

  /** Acceptance events are append-only and written only by acceptOrderRevision. */
  listConfirmations(orderId?: string): Promise<OrderConfirmation[]>;

  listPayments(orderId?: string): Promise<Payment[]>;
  /** Idempotent on client_transaction_id: returns the existing row with duplicate=true. */
  insertPayment(row: Insert<Payment>): Promise<{ payment: Payment; duplicate: boolean }>;
  updatePayment(id: string, patch: Partial<Payment>): Promise<Payment>;

  listHistory(orderId?: string): Promise<StatusHistory[]>;
  findHistoryByTransaction(clientTransactionId: string): Promise<StatusHistory | null>;
  insertHistory(row: Insert<StatusHistory>): Promise<StatusHistory>;

  listDeliveries(filter?: { driverId?: string; orderId?: string }): Promise<DeliveryAssignment[]>;
  insertDelivery(row: Insert<DeliveryAssignment>): Promise<DeliveryAssignment>;
  updateDelivery(id: string, patch: Partial<DeliveryAssignment>): Promise<DeliveryAssignment>;

  listExceptions(orderId?: string): Promise<OrderException[]>;
  insertException(row: Insert<OrderException>): Promise<OrderException>;
  updateException(id: string, patch: Partial<OrderException>): Promise<OrderException>;

  listNotifications(orderId?: string): Promise<NotificationLog[]>;
  insertNotification(row: Insert<NotificationLog>): Promise<NotificationLog>;
  updateNotification(id: string, patch: Partial<NotificationLog>): Promise<NotificationLog>;

  customerTrack(orderCode: string): Promise<CustomerTrack | null>;
  customerVerifyPin(orderCode: string, pin: string, clientKey: string): Promise<PinResult>;

  /** A store with elevated privileges for narrowly-scoped server operations. */
  elevated(): DataStore;
}
