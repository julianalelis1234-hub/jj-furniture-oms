import { randomUUID } from "node:crypto";
import { DomainError } from "@/lib/domain/errors";
import { computeFinancials } from "@/lib/domain/finance";
import { dimensionsText, diffSpecs } from "@/lib/domain/furniture";
import { assertProductionGate, blockingItems, isQuoteExpired, specOrQuoteChanged } from "@/lib/domain/gate";
import { assertTransition } from "@/lib/domain/status";
import { money } from "@/lib/domain/finance";
import { QUOTE_REVISION_TYPES } from "@/lib/domain/types";
import type {
  ConsumeReviewResult,
  CustomerAccount,
  QuoteReviewToken,
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
  AcceptRevisionInput,
  AcceptRevisionResult,
  AddRevisionInput,
  AddRevisionResult,
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
  quote_review_tokens: QuoteReviewToken[];
  /** demo stand-in for Supabase Auth users + customer profiles */
  customer_accounts: (CustomerAccount & { password_hash: string | null })[];
  /** demo password set-up / reset tokens (hash only) */
  password_tokens: { token_hash: string; user_id: string; purpose: "setup" | "reset"; expires_at: string; used_at: string | null }[];
  /** demo-only simulated inbox: the full email (with links) so testers can click them; never exists in production */
  demo_mailbox: { id: string; to: string; subject: string; text: string; order_id: string | null; created_at: string }[];
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
    quote_review_tokens: [],
    customer_accounts: [],
    password_tokens: [],
    demo_mailbox: [],
  };
}

const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();
const WORKSHOP_STATUSES = new Set(["Confirmed", "In Production", "Completed / For Inspection", "Ready for Delivery"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
      is_production_blocking: false,
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
    if (row.paper_slip_number && this.t.orders.some((o) => o.paper_slip_number === row.paper_slip_number))
      throw new DomainError("DUPLICATE_SLIP", "That paper slip number is already encoded in another order.");
    if (this.t.orders.some((o) => o.order_code === row.order_code))
      throw new DomainError("VALIDATION", `Order code ${row.order_code} already exists.`);
    if (row.client_request_key && this.t.orders.some((o) => o.client_request_key === row.client_request_key))
      throw new DomainError("DUPLICATE_REQUEST", "This request was already submitted.");
    if (!["Quote Requested", "Waiting for Confirmation"].includes(row.status) && !row.specs_confirmed)
      throw new DomainError("SPECS_NOT_CONFIRMED", "Customer must confirm specifications first.");
    const origin = row.order_origin ?? "staff_intake";
    const email = row.customer_email ?? null;
    const walkIn = row.has_no_email ?? false;
    if (email !== null && (email !== email.trim().toLowerCase() || !EMAIL_RE.test(email)))
      throw new DomainError("VALIDATION", "Enter a valid email address.");
    if (walkIn && email) throw new DomainError("VALIDATION", "A walk-in (paper slip only) order has no email.");
    if (!walkIn && !email) throw new DomainError("VALIDATION", "Enter the customer's email, or mark the order as Walk-In / No Email.");
    if (row.status === "Quote Requested" && (origin !== "customer_self_service" || row.specs_confirmed))
      throw new DomainError("VALIDATION", "Quote Requested is only for customer self-service requests.");
    if (row.status !== "Quote Requested" && (row.furniture_price == null || !row.paper_slip_number || !row.estimated_completion_date))
      throw new DomainError("VALIDATION", "A quotation needs a price, a paper slip number and an estimated completion date.");
    if (row.furniture_price != null && !(row.furniture_price > 0)) throw new DomainError("VALIDATION", "Furniture price must be greater than ₱0.");
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
      customer_email: email,
      has_no_email: walkIn,
      customer_user_id: null,
      email_verified_at: null,
      provisioning_status: walkIn ? "not_applicable" : "pending",
      legacy_contact_unknown: false,
      order_origin: origin,
      client_request_key: row.client_request_key ?? null,
      current_revision: 1,
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

    if ("customer_user_id" in patch || "email_verified_at" in patch || "legacy_contact_unknown" in patch)
      throw new DomainError("FORBIDDEN", "Account links and email verification are set only by the review-link and linking functions.");
    const next: Order = { ...current, ...patch };
    // mirrors private.orders_email_guard(): a new email must be verified again
    if (patch.customer_email !== undefined && patch.customer_email !== current.customer_email) {
      const e = patch.customer_email;
      if (e !== null && (e !== e.trim().toLowerCase() || !EMAIL_RE.test(e))) throw new DomainError("VALIDATION", "Enter a valid email address.");
      next.email_verified_at = null;
      next.customer_user_id = null;
      next.provisioning_status = e === null ? "not_applicable" : "pending";
    }
    if (next.customer_email || next.has_no_email) next.legacy_contact_unknown = false;
    if (next.has_no_email) {
      if (next.customer_email) throw new DomainError("VALIDATION", "A walk-in (paper slip only) order has no email.");
      next.provisioning_status = "not_applicable";
    }
    if (!next.has_no_email && !next.customer_email && !next.legacy_contact_unknown)
      throw new DomainError("VALIDATION", "Enter the customer's email, or mark the order as Walk-In / No Email.");
    this.recompute(next);
    if (next.wood_type === "Other" && !next.custom_wood_note?.trim())
      throw new DomainError("VALIDATION", 'Describe the wood when "Other" is selected.');
    if (specOrQuoteChanged(current, next)) {
      if (!["Quote Requested", "Waiting for Confirmation"].includes(current.status) && next.status !== "Waiting for Confirmation")
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
        assertProductionGate(next, this.t.order_specification_revisions, this.t.order_exceptions_and_repairs, current.status);
      }
    }
    if (!["Quote Requested", "Waiting for Confirmation"].includes(next.status) && !next.specs_confirmed)
      throw new DomainError("SPECS_NOT_CONFIRMED", "Customer must confirm specifications first.");
    if (next.status !== "Quote Requested" && (next.furniture_price == null || !next.paper_slip_number || !next.estimated_completion_date))
      throw new DomainError("VALIDATION", "A quotation needs a price, a paper slip number and an estimated completion date.");

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

  private specJson(r: Partial<SpecRevision> & { quoted_furniture_price: number | null; quoted_delivery_fee: number | null }) {
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
    const shop = QUOTE_REVISION_TYPES.includes(input.type);
    const initial = !this.t.order_specification_revisions.some((r) => r.order_id === o.id);
    if (initial) {
      if ((input.expected_revision ?? 0) !== 0) throw new DomainError("STALE_REVISION", "This order has no revisions yet.");
      if (input.type !== "staff_draft" && input.type !== "customer_request")
        throw new DomainError("VALIDATION", "The first revision must be a staff draft or a customer request.");
    } else {
      if (input.expected_revision !== o.current_revision)
        throw new DomainError("STALE_REVISION", `The specification changed (now revision ${o.current_revision}); reload before editing.`);
      if (input.type === "staff_draft" || input.type === "customer_request")
        throw new DomainError("VALIDATION", `${input.type} is only valid as revision 1.`);
    }
    if (
      (input.type === "customer_request" && o.status !== "Quote Requested") ||
      (input.type === "customer_proposal" && o.status !== "Waiting for Confirmation") ||
      (shop && !["Quote Requested", "Waiting for Confirmation", "Confirmed"].includes(o.status))
    )
      throw new DomainError("SPEC_LOCKED", "Specifications are locked for workshop production.");
    const sp = input.spec;
    const w = sp.width_cm, h = sp.height_cm, d = sp.depth_cm;
    let price: number | null = o.furniture_price;
    let fee: number | null = o.delivery_fee;
    let quotedAt: string | null = null, expiresAt: string | null = null;
    let slip = o.paper_slip_number, est = o.estimated_completion_date;
    if (shop) {
      price = sp.quoted_furniture_price ?? null;
      fee = o.municipality === "Valencia City" ? 0 : (sp.quoted_delivery_fee ?? o.delivery_fee ?? 0);
      if (price == null || !(price > 0) || fee < 0)
        throw new DomainError("VALIDATION", "A quotation needs a furniture price above ₱0 and a delivery fee of ₱0 or more.");
      const days = Math.min(90, Math.max(1, Math.round(input.quote_validity_days ?? 7)));
      quotedAt = now();
      expiresAt = new Date(Date.parse(quotedAt) + days * 86_400_000).toISOString();
      slip = input.paper_slip_number?.trim() || o.paper_slip_number;
      est = input.estimated_completion_date || o.estimated_completion_date;
      if (!slip) throw new DomainError("VALIDATION", "Enter the paper slip number for this quotation.");
      if (!est) throw new DomainError("VALIDATION", "Enter the estimated completion date for this quotation.");
      if (slip !== o.paper_slip_number && this.t.orders.some((x) => x.id !== o.id && x.paper_slip_number === slip))
        throw new DomainError("DUPLICATE_SLIP", `Paper slip #${slip} is already encoded.`);
    }
    if (!sp.furniture_category || !sp.design_variant?.trim() || w == null || h == null || d == null || !sp.wood_type || !sp.color_finish?.trim())
      throw new DomainError("VALIDATION", "Category, design, width, height, depth, wood and finish are required.");
    if ([w, h, d].some((v) => !(v > 0 && v <= 1000))) throw new DomainError("VALIDATION", "Dimensions must be between 0 and 1000 cm.");
    if (sp.wood_type === "Other" && !sp.custom_wood_note?.trim())
      throw new DomainError("VALIDATION", 'Describe the wood when "Other" is selected.');
    const qty = sp.quantity || o.quantity;
    const note = sp.wood_type === "Other" ? sp.custom_wood_note!.trim() : null;
    const next = this.specJson({
      furniture_category: sp.furniture_category, design_variant: sp.design_variant.trim(), width_cm: w, height_cm: h, depth_cm: d,
      wood_type: sp.wood_type, custom_wood_note: note, color_finish: sp.color_finish.trim(), quantity: qty,
      quoted_furniture_price: price, quoted_delivery_fee: fee,
    });
    const prev = initial ? undefined : this.t.order_specification_revisions.find((r) => r.order_id === o.id && r.revision_number === o.current_revision);
    const diff = prev ? diffSpecs(this.specJson(prev), next) : diffSpecs({}, next);
    if (prev && input.type === "customer_proposal" && Object.keys(diff).length === 0)
      throw new DomainError("VALIDATION", "No changes to submit.");
    const num = initial ? 1 : o.current_revision + 1;
    const rev: SpecRevision = {
      revision_id: randomUUID(), order_id: o.id, revision_number: num, revision_type: input.type,
      furniture_category: sp.furniture_category, design_variant: next.design_variant, width_cm: w, height_cm: h, depth_cm: d,
      wood_type: sp.wood_type, custom_wood_note: note, color_finish: next.color_finish!, quantity: qty,
      legacy_dimensions_text: null, quoted_furniture_price: price, quoted_delivery_fee: fee, quoted_at: quotedAt, expires_at: expiresAt,
      spec_preview_config: input.preview_config ?? {}, changed_fields: diff,
      created_by_role: input.created_by_role, created_by_id: input.created_by_id, created_at: now(),
    };
    this.t.order_specification_revisions.push(rev);
    if (!shop) {
      Object.assign(o, { current_revision: num, specs_confirmed: false, approved_revision_number: null });
    } else {
      Object.assign(o, {
        current_revision: num, furniture_category: sp.furniture_category, design_variant: rev.design_variant,
        width_cm: w, height_cm: h, depth_cm: d, wood_type: sp.wood_type, custom_wood_note: note, color_finish: rev.color_finish,
        quantity: qty, furniture_price: price, delivery_fee: fee, paper_slip_number: slip, estimated_completion_date: est,
        dimensions: dimensionsText({ width_cm: w, height_cm: h, depth_cm: d }),
        spec_preview_config: input.preview_config ?? {}, is_legacy_incomplete: false, specs_confirmed: false,
        approved_revision_number: null, status: "Waiting for Confirmation",
      });
      this.recompute(o);
    }
    o.version += 1;
    o.updated_at = now();
    return { revision_id: rev.revision_id, revision_number: num, revision_type: input.type, changed_fields: diff, quoted_at: quotedAt, expires_at: expiresAt };
  }

  async acceptOrderRevision(input: AcceptRevisionInput): Promise<AcceptRevisionResult> {
    const key = input.client_idempotency_key?.trim();
    if (!key || key.length > 100) throw new DomainError("VALIDATION", "A client idempotency key is required.");
    const o = this.find(this.t.orders, input.order_id, "Order"); // lock
    const prior = this.t.order_confirmations.find((c) => c.order_id === o.id && c.client_idempotency_key === key);
    if (prior) {
      if (prior.revision_id !== input.revision_id)
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This request key was already used for a different revision.");
      return { confirmation_id: prior.id, revision_id: prior.revision_id, revision_number: prior.revision_number, duplicate: true };
    }
    if (input.expected_revision_number !== o.current_revision)
      throw new DomainError("STALE_REVISION", `Revision ${input.expected_revision_number} is outdated; the latest is revision ${o.current_revision}.`);
    const rev = this.t.order_specification_revisions.find((r) => r.revision_id === input.revision_id && r.order_id === o.id);
    if (!rev || rev.revision_number !== o.current_revision)
      throw new DomainError("STALE_REVISION", "This is not the latest revision of the order.");
    if (!QUOTE_REVISION_TYPES.includes(rev.revision_type))
      throw new DomainError("PENDING_REVIEW", "The shop must review this request and issue a quotation first.");
    if (o.status !== "Waiting for Confirmation") throw new DomainError("INVALID_TRANSITION", "Order is not waiting for confirmation.");
    if (o.is_legacy_incomplete)
      throw new DomainError("VALIDATION", "Complete the structured specification (category, design, W × H × D) with a revised quote before confirming.");
    if (isQuoteExpired(rev))
      throw new DomainError("QUOTE_EXPIRED", "This quotation has expired. Ask JJ Furniture for a fresh quotation.");
    const qp = rev.quoted_furniture_price!, qf = rev.quoted_delivery_fee!;
    if (money(input.accepted_furniture_price) !== qp || money(input.accepted_delivery_fee) !== qf || money(input.accepted_total_amount) !== money(qp + qf))
      throw new DomainError("AMOUNT_MISMATCH", "The accepted amounts do not match the quotation. Please reload.");
    if (blockingItems(o.id, this.t.order_exceptions_and_repairs).length > 0)
      throw new DomainError("PENDING_REVIEW", "Resolve the open specification review items for this order first.");
    if (input.new_order_code && this.t.orders.some((x) => x.id !== o.id && x.order_code === input.new_order_code))
      throw new DomainError("VALIDATION", `Order code ${input.new_order_code} already exists.`);
    const ts = now();
    const conf: OrderConfirmation = {
      id: randomUUID(), order_id: o.id, version_number: rev.revision_number, revision_number: rev.revision_number, revision_id: rev.revision_id,
      confirmed_specs_snapshot: {
        ...this.specJson(rev), item_name: o.item_name, dimensions: o.dimensions, wood_type: rev.wood_type,
        color_finish: rev.color_finish, quantity: rev.quantity, furniture_price: qp, expires_at: rev.expires_at,
      },
      confirmation_method: input.method, confirmed_by_name: input.confirmed_by_name.trim() || o.customer_name,
      recorded_by_staff_id: input.recorded_by, confirmed_at: ts,
      specification_accepted_at: ts, quotation_accepted_at: ts,
      accepted_furniture_price: qp, accepted_delivery_fee: qf, accepted_total_amount: money(qp + qf), client_idempotency_key: key,
    };
    const next: Order = { ...o, approved_revision_number: rev.revision_number, specs_confirmed: true, status: "Confirmed", order_code: input.new_order_code ?? o.order_code };
    assertProductionGate(next, this.t.order_specification_revisions, this.t.order_exceptions_and_repairs, o.status);
    this.t.order_confirmations.push(conf);
    Object.assign(o, next, { version: o.version + 1, updated_at: ts });
    return { confirmation_id: conf.id, revision_id: rev.revision_id, revision_number: rev.revision_number, duplicate: false };
  }

  // ---------------------------------------------------------- confirmations
  async listConfirmations(orderId?: string) {
    return clone(this.t.order_confirmations.filter((c) => !orderId || c.order_id === orderId));
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
    // audit-safe ledger (mirrors private.payments_guard): only verification and appended notes may change
    const allowed = new Set(["verified_by_owner_or_staff", "notes"]);
    if (Object.keys(patch).some((k) => !allowed.has(k) && patch[k as keyof Payment] !== p[k as keyof Payment]))
      throw new DomainError("IMMUTABLE_RECORD", "Only verification and appended notes may change on a payment.");
    if (p.verified_by_owner_or_staff && patch.verified_by_owner_or_staff === false)
      throw new DomainError("IMMUTABLE_RECORD", "A verified payment cannot be un-verified.");
    if (p.notes && patch.notes !== undefined && !(patch.notes ?? "").startsWith(p.notes))
      throw new DomainError("IMMUTABLE_RECORD", "Payment notes can only be appended.");
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
    // an open specification question always blocks confirmation and production
    if (e.category === "Spec Clarification") e.is_production_blocking = true;
    e.is_production_blocking = !!e.is_production_blocking;
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

  // ------------------------------------------------ customer email auth (005)
  async issueReviewToken(input: { order_id: string; revision_id: string; token_hash: string; ttl_hours: number }) {
    const o = this.find(this.t.orders, input.order_id, "Order"); // lock
    if (o.has_no_email || !o.customer_email) throw new DomainError("VALIDATION", "This order has no customer email (walk-in / paper slip only).");
    const rev = this.t.order_specification_revisions.find((r) => r.revision_id === input.revision_id && r.order_id === o.id);
    if (!rev || rev.revision_number !== o.current_revision || !QUOTE_REVISION_TYPES.includes(rev.revision_type))
      throw new DomainError("STALE_REVISION", "A review link can only be issued for the current shop quotation.");
    const ts = now();
    for (const t of this.t.quote_review_tokens)
      if (t.order_id === o.id && !t.consumed_at && !t.invalidated_at) t.invalidated_at = ts;
    const hours = Math.min(336, Math.max(1, Math.round(input.ttl_hours)));
    const row: QuoteReviewToken = {
      token_id: randomUUID(), order_id: o.id, revision_id: rev.revision_id, token_hash: input.token_hash.toLowerCase(),
      sent_to_email: o.customer_email, expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
      consumed_at: null, invalidated_at: null, created_at: ts,
    };
    if (this.t.quote_review_tokens.some((t) => t.token_hash === row.token_hash)) throw new DomainError("VALIDATION", "Token collision.");
    this.t.quote_review_tokens.push(row);
    return { token_id: row.token_id, expires_at: row.expires_at, sent_to_email: row.sent_to_email };
  }

  async consumeReviewToken(tokenHash: string): Promise<ConsumeReviewResult> {
    const t = this.t.quote_review_tokens.find((x) => x.token_hash === tokenHash.toLowerCase());
    if (!t) return { ok: false, reason: "invalid" };
    if (t.consumed_at) return { ok: false, reason: "used" };
    if (t.invalidated_at) return { ok: false, reason: "replaced" };
    if (Date.now() > Date.parse(t.expires_at)) return { ok: false, reason: "expired" };
    const o = this.find(this.t.orders, t.order_id, "Order");
    const rev = this.t.order_specification_revisions.find((r) => r.revision_id === t.revision_id)!;
    if (o.customer_email !== t.sent_to_email) { t.invalidated_at = now(); return { ok: false, reason: "email_changed" }; }
    if (rev.revision_number !== o.current_revision) { t.invalidated_at = now(); return { ok: false, reason: "replaced" }; }
    t.consumed_at = now();
    o.email_verified_at ??= now();
    o.version += 1;
    o.updated_at = now();
    return { ok: true, order_id: o.id, revision_id: t.revision_id, revision_number: rev.revision_number, email: t.sent_to_email };
  }

  async linkCustomerAccount(orderId: string, userId: string) {
    const o = this.find(this.t.orders, orderId, "Order");
    const acct = this.t.customer_accounts.find((a) => a.id === userId);
    if (!acct || !acct.is_active) throw new DomainError("FORBIDDEN", "Not an active customer account.");
    if (!o.email_verified_at) throw new DomainError("FORBIDDEN", "Email ownership has not been verified for this order.");
    if (acct.email.trim().toLowerCase() !== o.customer_email) throw new DomainError("FORBIDDEN", "Account email does not match the verified order email.");
    if (o.customer_user_id === userId) return { linked: true, already: true };
    if (o.customer_user_id) throw new DomainError("FORBIDDEN", "Order is linked to another account.");
    Object.assign(o, { customer_user_id: userId, provisioning_status: "linked", version: o.version + 1, updated_at: now() });
    return { linked: true, already: false };
  }

  async listCustomerOrders(userId: string) {
    return clone(this.t.orders.filter((o) => o.customer_user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }

  private toAccount(a: CustomerAccount & { password_hash: string | null }): CustomerAccount {
    return { id: a.id, email: a.email, full_name: a.full_name, is_active: a.is_active, created_at: a.created_at };
  }
  async findCustomerAccountByEmail(email: string) {
    const e = email.trim().toLowerCase();
    const a = this.t.customer_accounts.find((x) => x.email === e);
    return a ? this.toAccount(a) : null;
  }
  async getCustomerAccount(id: string) {
    const a = this.t.customer_accounts.find((x) => x.id === id);
    return a ? this.toAccount(a) : null;
  }
  async emailBelongsToStaff(email: string) {
    // demo staff have no email addresses on file; production checks every profile
    void email;
    return false;
  }
  async insertCustomerProfile(row: { id: string; email: string; full_name: string }) {
    const e = row.email.trim().toLowerCase();
    if (this.t.customer_accounts.some((a) => a.email === e)) throw new DomainError("DUPLICATE_REQUEST", "An account with this email already exists.");
    const a = { id: row.id, email: e, full_name: row.full_name, is_active: true, created_at: now(), password_hash: null };
    this.t.customer_accounts.push(a);
    return this.toAccount(a);
  }
}
