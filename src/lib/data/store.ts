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

export type ComputedOrderFields =
  | "id"
  | "standard_down_payment_due"
  | "remaining_furniture_balance"
  | "collectible_on_delivery"
  | "version"
  | "created_at"
  | "updated_at";

export type NewOrderRow = Omit<Order, ComputedOrderFields>;
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
