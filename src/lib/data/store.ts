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

export type NewOrderRow = Omit<Order, ComputedOrderFields> & { is_legacy_incomplete?: boolean };

/** A proposed specification (+ quote for shop revisions). */
export interface SpecInput extends FurnitureSpec {
  quoted_furniture_price?: number;
  quoted_delivery_fee?: number;
}

export interface AddRevisionInput {
  order_id: string;
  type: Exclude<RevisionType, "final_approved">;
  spec: SpecInput;
  /** the revision the editor was looking at (optimistic check) */
  expected_revision: number | null;
  created_by_role: string;
  created_by_id: string | null;
  preview_config?: Record<string, unknown>;
}
export interface AddRevisionResult {
  id: string;
  revision_number: number;
  revision_type: RevisionType;
  changed_fields: Record<string, { from: unknown; to: unknown }>;
}

export interface ConfirmRevisionInput {
  order_id: string;
  revision_number: number;
  method: ConfirmationMethod;
  confirmed_by_name: string;
  recorded_by: string | null;
  new_order_code: string | null;
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
  /** Customer confirmation of one exact revision; moves the order to Confirmed atomically. */
  confirmSpecRevision(input: ConfirmRevisionInput): Promise<{ confirmation_id: string; revision_id: string; revision_number: number }>;

  listConfirmations(orderId?: string): Promise<OrderConfirmation[]>;
  insertConfirmation(row: Insert<OrderConfirmation>): Promise<OrderConfirmation>;

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
