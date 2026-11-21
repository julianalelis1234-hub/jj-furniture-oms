import { randomUUID } from "node:crypto";
import { DomainError } from "@/lib/domain/errors";
import { computeFinancials } from "@/lib/domain/finance";
import { verifyPinHash } from "@/lib/domain/pin";
import { dimensionsText, diffSpecs } from "@/lib/domain/furniture";
import { assertProductionGate, specOrQuoteChanged } from "@/lib/domain/gate";
import { assertTransition } from "@/lib/domain/status";
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
  SpecRevision,
  StatusHistory,
  WorkshopOrder,
} from "@/lib/domain/types";
import type {
  AddRevisionInput,
  AddRevisionResult,
  ConfirmRevisionInput,
  DataStore,
  Insert,
  NewOrderRow,
  OrderPatch,
  UpdateResult,
} from "./store";

export interface MemoryTables {
  profiles: Profile[];
  orders: Order[];
  order_confirmations: OrderConfirmation[];
  payments: Payment[];
  order_status_history: StatusHistory[];
  delivery_assignments: DeliveryAssignment[];
  order_exceptions_and_repairs: OrderException[];
  notifications: NotificationLog[];
  order_specification_revisions: SpecRevision[];
  pin_attempts: { order_code: string; client_key: string; succeeded: boolean; at: number }[];
}

export function emptyTables(): MemoryTables {
  return {
    profiles: [],
    orders: [],
    order_confirmations: [],
    payments: [],
    order_status_history: [],
    delivery_assignments: [],
    order_exceptions_and_repairs: [],
    notifications: [],
    order_specification_revisions: [],
    pin_attempts: [],
  };
}

const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();
const WORKSHOP_STATUSES = new Set(["Confirmed", "In Production", "Completed / For Inspection", "Ready for Delivery"]);
const PIN_MAX_FAILURES = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * In-memory implementation used for Demo Mode without a Supabase project and
 * for unit tests. It reproduces every rule the Postgres triggers enforce.
 */
export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;
  constructor(public t: MemoryTables = emptyTables()) {}

  elevated(): DataStore {
    return this;
  }

  // ---------------------------------------------------------------- helpers
  private recompute(order: Order) {
    const f = computeFinancials(order, this.t.payments.filter((p) => p.order_id === order.id));
    Object.assign(order, f);
  }

  private touch(orderId: string) {
    const o = this.t.orders.find((x) => x.id === orderId);
    if (!o) return;
    this.recompute(o);
    o.version += 1;
    o.updated_at = now();
  }

  private exceptionGate(order: Order) {
    if (order.payment_exception_type === "Standard 30/70" || order.payment_exception_approved) return;
    const pending = this.t.order_exceptions_and_repairs.some(
      (e) =>
        e.order_id === order.id &&
        e.status === "Pending" &&
        (e.category === "Installment Approval" || e.category === "Credit / Unpaid Balance"),
    );
    if (pending) return;
    this.t.order_exceptions_and_repairs.push({
      id: randomUUID(),
      order_id: order.id,
      category: order.payment_exception_type === "Installment" ? "Installment Approval" : "Credit / Unpaid Balance",
      description: `${order.payment_exception_type} requested for ${order.order_code} (${order.customer_name}). Owner approval required.`,
      requested_by: "System (payment terms)",
      status: "Pending",
      resolved_by_id: null,
      created_at: now(),
      resolved_at: null,
    });
  }

  private find<T extends { id: string }>(rows: T[], id: string, label: string): T {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new DomainError("NOT_FOUND", `${label} not found.`);
    return row;
  }

  // --------------------------------------------------------------- profiles
  async listProfiles() {
    return clone(this.t.profiles);
  }

  // ----------------------------------------------------------------- orders
  async listOrders() {
    return clone(this.t.orders);
  }
  async getOrder(id: string) {
    return clone(this.t.orders.find((o) => o.id === id) ?? null);
  }
  async getOrderByCode(code: string) {
    const c = code.trim().toUpperCase();
    return clone(this.t.orders.find((o) => o.order_code === c) ?? null);
  }

  async insertOrder(row: NewOrderRow): Promise<Order> {
    if (this.t.orders.some((o) => o.paper_slip_number === row.paper_slip_number))
      throw new DomainError("DUPLICATE_SLIP", "That paper slip number is already encoded in another order.");
    if (this.t.orders.some((o) => o.order_code === row.order_code))
      throw new DomainError("VALIDATION", `Order code ${row.order_code} already exists.`);
    if (row.status !== "Waiting for Confirmation" && !row.specs_confirmed)
      throw new DomainError("SPECS_NOT_CONFIRMED", "Customer must confirm specifications first.");
    if (!(row.furniture_price > 0)) throw new DomainError("VALIDATION", "Furniture price must be greater than ₱0.");
    if (!(row.quantity > 0)) throw new DomainError("VALIDATION", "Quantity must be at least 1.");
    const legacy = row.is_legacy_incomplete ?? false;
    if (!legacy && (!row.furniture_category || !row.design_variant?.trim() || row.width_cm == null || row.height_cm == null || row.depth_cm == null))
      throw new DomainError("VALIDATION", "Category, design and dimensions (0–1000 cm) are required.");
    for (const v of [row.width_cm, row.height_cm, row.depth_cm])
      if (v != null && !(v > 0 && v <= 1000)) throw new DomainError("VALIDATION", "Dimensions must be between 0 and 1000 cm.");
    if (row.wood_type === "Other" && !row.custom_wood_note?.trim())
      throw new DomainError("VALIDATION", 'Describe the wood when "Other" is selected.');
    const ts = now();
    const order: Order = {
      ...row,
      current_revision: null,
      approved_revision_number: null,
      spec_preview_config: {},
      is_legacy_incomplete: legacy,
      id: randomUUID(),
      standard_down_payment_due: 0,
      remaining_furniture_balance: 0,
      collectible_on_delivery: 0,
      version: 1,
      created_at: ts,
      updated_at: ts,
    };
    this.recompute(order);
    this.t.orders.push(order);
    this.exceptionGate(order);
    return clone(order);
  }

  async updateOrder(id: string, patch: OrderPatch, expectedVersion?: number): Promise<UpdateResult> {
    const current = this.find(this.t.orders, id, "Order");
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      return { ok: false, reason: "conflict", current: clone(current) };
    }
    if (patch.paper_slip_number && this.t.orders.some((o) => o.id !== id && o.paper_slip_number === patch.paper_slip_number))
      throw new DomainError("DUPLICATE_SLIP", "That paper slip number is already encoded in another order.");
    if (patch.order_code && this.t.orders.some((o) => o.id !== id && o.order_code === patch.order_code))
      throw new DomainError("VALIDATION", `Order code ${patch.order_code} already exists.`);

    const next: Order = { ...current, ...patch };
    this.recompute(next);
    if (next.wood_type === "Other" && !next.custom_wood_note?.trim())
      throw new DomainError("VALIDATION", 'Describe the wood when "Other" is selected.');
    if (specOrQuoteChanged(current, next)) {
      if (next.status !== "Waiting for Confirmation")
        throw new DomainError("SPEC_LOCKED", "Specifications and quote are locked once confirmed; use a change request.");
      next.specs_confirmed = false;
      next.approved_revision_number = null;
    }
    if (patch.status && patch.status !== current.status) {
      assertTransition(
        { ...next, status: current.status, specs_confirmed: true },
        patch.status,
        this.t.payments.filter((p) => p.order_id === id),
      );
      if (patch.status === "Confirmed" || patch.status === "In Production") {
        assertProductionGate(next, this.t.order_specification_revisions, this.t.order_exceptions_and_repairs);
      }
    }
    if (next.status !== "Waiting for Confirmation" && !next.specs_confirmed)
      throw new DomainError("SPECS_NOT_CONFIRMED", "Customer must confirm specifications first.");

    const typeChanged = next.payment_exception_type !== current.payment_exception_type;
    next.version = current.version + 1;
    next.updated_at = now();
    Object.assign(current, next);
    if (typeChanged) this.exceptionGate(current);
    return { ok: true, order: clone(current) };
  }

  async listWorkshopOrders(): Promise<WorkshopOrder[]> {
    return this.t.orders
      .filter((o) => WORKSHOP_STATUSES.has(o.status))
      .map((o) => {
        const hist = this.t.order_status_history
          .filter((h) => h.order_id === o.id)
          .sort((a, b) => b.changed_at.localeCompare(a.changed_at));
        const last = hist[0];
        return {
          id: o.id,
          order_code: o.order_code,
          item_name: o.item_name,
          quantity: o.quantity,
          dimensions: o.dimensions,
          wood_type: o.wood_type,
          color_finish: o.color_finish,
          special_instructions: o.special_instructions,
          reference_photo_url: o.reference_photo_url,
          status: o.status,
          priority_rank: o.priority_rank,
          priority_label: o.priority_label,
          assigned_craftsman_id: o.assigned_craftsman_id,
          estimated_completion_date: o.estimated_completion_date,
          version: o.version,
          updated_at: o.updated_at,
          needs_revision:
            !!last && last.from_status === "Completed / For Inspection" && last.to_status === "In Production",
          furniture_category: o.furniture_category,
          design_variant: o.design_variant,
          width_cm: o.width_cm,
          height_cm: o.height_cm,
          depth_cm: o.depth_cm,
          custom_wood_note: o.custom_wood_note,
          approved_revision_number: o.approved_revision_number,
          is_legacy_incomplete: o.is_legacy_incomplete,
        };
      });
  }

  // ------------------------------------------------------------ revisions
  async listRevisions(orderId: string) {
    return clone(
      this.t.order_specification_revisions
        .filter((r) => r.order_id === orderId)
        .sort((a, b) => a.revision_number - b.revision_number),
    );
  }

  private specJson(r: Partial<SpecRevision> & { quoted_furniture_price: number; quoted_delivery_fee: number }) {
    return {
      furniture_category: r.furniture_category ?? null,
      design_variant: r.design_variant ?? null,
      width_cm: r.width_cm ?? null,
      height_cm: r.height_cm ?? null,
      depth_cm: r.depth_cm ?? null,
      wood_type: r.wood_type ?? null,
      custom_wood_note: r.custom_wood_note ?? null,
      color_finish: r.color_finish ?? null,
      quantity: r.quantity ?? null,
      quoted_furniture_price: r.quoted_furniture_price,
      quoted_delivery_fee: r.quoted_delivery_fee,
    };
  }

  async addSpecRevision(input: AddRevisionInput): Promise<AddRevisionResult> {
    const o = this.find(this.t.orders, input.order_id, "Order"); // single-threaded: equivalent of SELECT ... FOR UPDATE
    if ((input.expected_revision ?? null) !== (o.current_revision ?? null))
      throw new DomainError("STALE_REVISION", `The specification changed (now revision ${o.current_revision}); reload before editing.`);
    if (!["Waiting for Confirmation", "Confirmed"].includes(o.status) || (input.type === "customer_proposal" && o.status !== "Waiting for Confirmation"))
      throw new DomainError("SPEC_LOCKED", "Specifications are locked for workshop production.");
    const sp = input.spec;
    const w = sp.width_cm, h = sp.height_cm, d = sp.depth_cm;
    if (!sp.furniture_category || !sp.design_variant?.trim() || w == null || h == null || d == null || !sp.wood_type || !sp.color_finish?.trim())
      throw new DomainError("VALIDATION", "Category, design, width, height, depth, wood and finish are required.");
    if ([w, h, d].some((v) => !(v > 0 && v <= 1000))) throw new DomainError("VALIDATION", "Dimensions must be between 0 and 1000 cm.");
    if (sp.wood_type === "Other" && !sp.custom_wood_note?.trim())
      throw new DomainError("VALIDATION", 'Describe the wood when "Other" is selected.');
    let price = sp.quoted_furniture_price ?? o.furniture_price;
    let fee = sp.quoted_delivery_fee ?? o.delivery_fee;
    if (o.municipality === "Valencia City") fee = 0;
    if (input.type === "customer_proposal") { price = o.furniture_price; fee = o.delivery_fee; }
    const qty = sp.quantity || o.quantity;
    const note = sp.wood_type === "Other" ? sp.custom_wood_note!.trim() : null;
    const next = this.specJson({
      furniture_category: sp.furniture_category, design_variant: sp.design_variant.trim(), width_cm: w, height_cm: h, depth_cm: d,
      wood_type: sp.wood_type, custom_wood_note: note, color_finish: sp.color_finish.trim(), quantity: qty,
      quoted_furniture_price: price, quoted_delivery_fee: fee,
    });
    const prev = this.t.order_specification_revisions.find((r) => r.order_id === o.id && r.revision_number === o.current_revision);
    const diff = prev ? diffSpecs(this.specJson(prev), next) : diffSpecs({}, next);
    if (prev && input.type === "customer_proposal" && Object.keys(diff).length === 0)
      throw new DomainError("VALIDATION", "No changes to submit.");
    const num = (o.current_revision ?? 0) + 1;
    const rev: SpecRevision = {
      id: randomUUID(), order_id: o.id, revision_number: num, revision_type: input.type,
      furniture_category: sp.furniture_category, design_variant: next.design_variant, width_cm: w, height_cm: h, depth_cm: d,
      wood_type: sp.wood_type, custom_wood_note: note, color_finish: next.color_finish!, quantity: qty,
      legacy_dimensions_text: null, quoted_furniture_price: price, quoted_delivery_fee: fee,
      spec_preview_config: input.preview_config ?? {}, changed_fields: diff,
      created_by_role: input.created_by_role, created_by_id: input.created_by_id, created_at: now(),
    };
    this.t.order_specification_revisions.push(rev);
    if (input.type === "customer_proposal") {
      Object.assign(o, { current_revision: num, specs_confirmed: false, approved_revision_number: null });
    } else {
      Object.assign(o, {
        current_revision: num, furniture_category: sp.furniture_category, design_variant: rev.design_variant,
        width_cm: w, height_cm: h, depth_cm: d, wood_type: sp.wood_type, custom_wood_note: note, color_finish: rev.color_finish,
        quantity: qty, furniture_price: price, delivery_fee: fee, dimensions: dimensionsText({ width_cm: w, height_cm: h, depth_cm: d }),
        spec_preview_config: input.preview_config ?? {}, is_legacy_incomplete: false, specs_confirmed: false,
        approved_revision_number: null, status: "Waiting for Confirmation",
      });
      this.recompute(o);
    }
    o.version += 1;
    o.updated_at = now();
    return { id: rev.id, revision_number: num, revision_type: input.type, changed_fields: diff };
  }

  async confirmSpecRevision(input: ConfirmRevisionInput) {
    const o = this.find(this.t.orders, input.order_id, "Order");
    if (o.status !== "Waiting for Confirmation") throw new DomainError("INVALID_TRANSITION", "Order is not waiting for confirmation.");
    if (o.is_legacy_incomplete)
      throw new DomainError("VALIDATION", "Complete the structured specification (category, design, W × H × D) with a revised quote before confirming.");
    if (input.revision_number !== o.current_revision)
      throw new DomainError("STALE_REVISION", `Revision ${input.revision_number} is outdated; the latest is revision ${o.current_revision}.`);
    const rev = this.t.order_specification_revisions.find((r) => r.order_id === o.id && r.revision_number === input.revision_number);
    if (!rev || rev.revision_type === "customer_proposal")
      throw new DomainError("PENDING_REVIEW", "The shop must review the proposed changes and send a revised quote first.");
    if (this.t.order_exceptions_and_repairs.some((e) => e.order_id === o.id && e.status === "Pending"))
      throw new DomainError("PENDING_REVIEW", "Resolve the open review items for this order first.");
    if (input.new_order_code && this.t.orders.some((x) => x.id !== o.id && x.order_code === input.new_order_code))
      throw new DomainError("VALIDATION", `Order code ${input.new_order_code} already exists.`);
    const conf: OrderConfirmation = {
      id: randomUUID(), order_id: o.id, version_number: rev.revision_number, revision_number: rev.revision_number, revision_id: rev.id,
      confirmed_specs_snapshot: {
        ...this.specJson(rev), item_name: o.item_name, dimensions: o.dimensions, wood_type: rev.wood_type,
        color_finish: rev.color_finish, quantity: rev.quantity, furniture_price: rev.quoted_furniture_price,
      },
      confirmation_method: input.method, confirmed_by_name: input.confirmed_by_name.trim() || o.customer_name,
      recorded_by_staff_id: input.recorded_by, confirmed_at: now(),
    };
    const next: Order = { ...o, approved_revision_number: rev.revision_number, specs_confirmed: true, status: "Confirmed", order_code: input.new_order_code ?? o.order_code };
    assertProductionGate(next, this.t.order_specification_revisions, this.t.order_exceptions_and_repairs);
    this.t.order_confirmations.push(conf);
    Object.assign(o, next, { version: o.version + 1, updated_at: now() });
    return { confirmation_id: conf.id, revision_id: rev.id, revision_number: rev.revision_number };
  }

  // ---------------------------------------------------------- confirmations
  async listConfirmations(orderId?: string) {
    return clone(this.t.order_confirmations.filter((c) => !orderId || c.order_id === orderId));
  }
  async insertConfirmation(row: Insert<OrderConfirmation>) {
    if (this.t.order_confirmations.some((c) => c.order_id === row.order_id && c.version_number === row.version_number))
      throw new DomainError("VALIDATION", "This confirmation version already exists.");
    const c = { ...row, id: row.id ?? randomUUID() } as OrderConfirmation;
    this.t.order_confirmations.push(c);
    return clone(c);
  }

  // --------------------------------------------------------------- payments
  async listPayments(orderId?: string) {
    return clone(this.t.payments.filter((p) => !orderId || p.order_id === orderId));
  }
  async insertPayment(row: Insert<Payment>) {
    const existing = this.t.payments.find((p) => p.client_transaction_id === row.client_transaction_id);
    if (existing) return { payment: clone(existing), duplicate: true };
    if (!(row.amount > 0)) throw new DomainError("VALIDATION", "Amount must be greater than ₱0.");
    this.find(this.t.orders, row.order_id, "Order");
    const p = { ...row, id: row.id ?? randomUUID() } as Payment;
    this.t.payments.push(p);
    this.touch(p.order_id);
    return { payment: clone(p), duplicate: false };
  }
  async updatePayment(id: string, patch: Partial<Payment>) {
    const p = this.find(this.t.payments, id, "Payment");
    Object.assign(p, patch, { id });
    this.touch(p.order_id);
    return clone(p);
  }

  // ---------------------------------------------------------------- history
  async listHistory(orderId?: string) {
    return clone(
      this.t.order_status_history
        .filter((h) => !orderId || h.order_id === orderId)
        .sort((a, b) => b.changed_at.localeCompare(a.changed_at)),
    );
  }
  async findHistoryByTransaction(txn: string) {
    return clone(this.t.order_status_history.find((h) => h.client_transaction_id === txn) ?? null);
  }
  async insertHistory(row: Insert<StatusHistory>) {
    if (row.client_transaction_id && this.t.order_status_history.some((h) => h.client_transaction_id === row.client_transaction_id))
      throw new DomainError("VALIDATION", "Duplicate client transaction.");
    const h = { ...row, id: row.id ?? randomUUID() } as StatusHistory;
    this.t.order_status_history.push(h);
    return clone(h);
  }

  // ------------------------------------------------------------- deliveries
  async listDeliveries(filter?: { driverId?: string; orderId?: string }) {
    return clone(
      this.t.delivery_assignments.filter(
        (d) => (!filter?.driverId || d.driver_id === filter.driverId) && (!filter?.orderId || d.order_id === filter.orderId),
      ),
    );
  }
  async insertDelivery(row: Insert<DeliveryAssignment>) {
    if (
      row.dispatch_status !== "Failed / Reschedule" &&
      this.t.delivery_assignments.some((d) => d.order_id === row.order_id && d.dispatch_status !== "Failed / Reschedule")
    )
      throw new DomainError("VALIDATION", "This order already has an active delivery assignment.");
    const d = { ...row, id: row.id ?? randomUUID(), updated_at: now() } as DeliveryAssignment;
    this.t.delivery_assignments.push(d);
    return clone(d);
  }
  async updateDelivery(id: string, patch: Partial<DeliveryAssignment>) {
    const d = this.find(this.t.delivery_assignments, id, "Delivery");
    Object.assign(d, patch, { id, updated_at: now() });
    return clone(d);
  }

  // ------------------------------------------------------------- exceptions
  async listExceptions(orderId?: string) {
    return clone(this.t.order_exceptions_and_repairs.filter((e) => !orderId || e.order_id === orderId));
  }
  async insertException(row: Insert<OrderException>) {
    const e = { ...row, id: row.id ?? randomUUID() } as OrderException;
    this.t.order_exceptions_and_repairs.push(e);
    return clone(e);
  }
  async updateException(id: string, patch: Partial<OrderException>) {
    const e = this.find(this.t.order_exceptions_and_repairs, id, "Exception");
    const wasPending = e.status === "Pending";
    Object.assign(e, patch, { id });
    if (wasPending && e.status !== "Pending") e.resolved_at = e.resolved_at ?? now();
    return clone(e);
  }

  // ---------------------------------------------------------- notifications
  async listNotifications(orderId?: string) {
    return clone(this.t.notifications.filter((n) => !orderId || n.order_id === orderId));
  }
  async insertNotification(row: Insert<NotificationLog>) {
    const n = { ...row, id: row.id ?? randomUUID() } as NotificationLog;
    this.t.notifications.push(n);
    return clone(n);
  }
  async updateNotification(id: string, patch: Partial<NotificationLog>) {
    const n = this.find(this.t.notifications, id, "Notification");
    Object.assign(n, patch, { id });
    return clone(n);
  }

  // --------------------------------------------------------------- customer
  async customerTrack(orderCode: string): Promise<CustomerTrack | null> {
    const o = this.t.orders.find((x) => x.order_code === orderCode.trim().toUpperCase());
    if (!o) return null;
    return {
      order_code: o.order_code,
      item_name: o.item_name,
      status: o.status,
      estimated_completion_date: o.estimated_completion_date,
      scheduled_delivery_date: o.scheduled_delivery_date,
      updated_at: o.updated_at,
    };
  }

  async customerVerifyPin(orderCode: string, pin: string, clientKey: string): Promise<PinResult> {
    const code = orderCode.trim().toUpperCase();
    const since = Date.now() - PIN_WINDOW_MS;
    const failures = this.t.pin_attempts.filter(
      (a) => a.order_code === code && a.client_key === clientKey && !a.succeeded && a.at > since,
    ).length;
    if (failures >= PIN_MAX_FAILURES) return { ok: false, locked: true, remaining_attempts: 0 };
    const o = this.t.orders.find((x) => x.order_code === code);
    const ok = !!o && verifyPinHash(pin, o.pin_code_hash);
    this.t.pin_attempts.push({ order_code: code, client_key: clientKey, succeeded: ok, at: Date.now() });
    if (ok) return { ok: true, order_id: o!.id };
    return {
      ok: false,
      locked: failures + 1 >= PIN_MAX_FAILURES,
      remaining_attempts: Math.max(0, PIN_MAX_FAILURES - failures - 1),
    };
  }
}
