// Row types mirror supabase/migrations/001_init.sql exactly (snake_case columns).

export const ROLES = ["owner", "staff", "craftsman", "driver"] as const;
export type Role = (typeof ROLES)[number];

export const MUNICIPALITIES = [
  "Valencia City",
  "Lantapan",
  "Cabanglasan",
  "Pangantucan",
  "San Fernando",
  "Other",
] as const;
export type Municipality = (typeof MUNICIPALITIES)[number];

export const WOOD_TYPES = ["Mahogany", "Gmelina", "Other"] as const;
export type WoodType = (typeof WOOD_TYPES)[number];

/** The Seven-Stage Workshop and Delivery Pipeline (unchanged). */
export const WORKSHOP_STAGES = [
  "Waiting for Confirmation",
  "Confirmed",
  "In Production",
  "Completed / For Inspection",
  "Ready for Delivery",
  "Out for Delivery",
  "Delivered",
] as const;
export type WorkshopStage = (typeof WORKSHOP_STAGES)[number];

/** Pre-production intake state for Option 2 customer self-service requests (not a workshop stage). */
export const PRE_PRODUCTION_STATUS = "Quote Requested" as const;

export const ORDER_STATUSES = [PRE_PRODUCTION_STATUS, ...WORKSHOP_STAGES] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ORIGINS = ["staff_intake", "customer_self_service"] as const;
export type OrderOrigin = (typeof ORDER_ORIGINS)[number];

export const PRIORITY_LABELS = ["Urgent", "High", "Normal"] as const;
export type PriorityLabel = (typeof PRIORITY_LABELS)[number];

export const PAYMENT_EXCEPTION_TYPES = ["Standard 30/70", "Installment", "Credit / Pay Later"] as const;
export type PaymentExceptionType = (typeof PAYMENT_EXCEPTION_TYPES)[number];

export const CONFIRMATION_METHODS = ["Signed Paper Slip", "Messenger Reply", "Customer Portal PIN"] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

export const PAYMENT_TYPES = [
  "Down Payment (30%)",
  "Delivery Balance Collection",
  "Installment / Partial",
  "Delivery Fee",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_METHODS = ["Cash", "GCash / Bank Transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const VEHICLE_TYPES = ["Multicab", "Elf Truck"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const DISPATCH_STATUSES = ["Scheduled", "Out for Delivery", "Delivered", "Failed / Reschedule"] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const EXCEPTION_CATEGORIES = [
  "Installment Approval",
  "Credit / Unpaid Balance",
  "Special Delivery Terms",
  "Spec Clarification",
  "On-Site Scratch Touch-Up / Repair",
] as const;
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];

export const EXCEPTION_STATUSES = ["Pending", "Approved", "Rejected", "Resolved"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["SMS", "Messenger", "In-App"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationStatus = "Sent" | "Failed" | "Pending";

export const REVISION_TYPES = ["staff_draft", "customer_request", "customer_proposal", "revised_quote", "final_approved"] as const;
/** Revisions a customer may accept: an issued shop quotation. */
export const QUOTE_REVISION_TYPES: readonly RevisionType[] = ["staff_draft", "revised_quote"];
export type RevisionType = (typeof REVISION_TYPES)[number];

export type FurnitureCategoryName =
  | "Panel Door"
  | "Dining Table"
  | "Living Room Set"
  | "Kitchen / Wall Cabinet"
  | "Custom Piece";

/** Authoritative structured specification columns (migration 003). */
export interface StructuredSpecColumns {
  furniture_category: FurnitureCategoryName | null;
  design_variant: string | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  custom_wood_note: string | null;
}

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Order extends StructuredSpecColumns {
  id: string;
  order_code: string;
  /** NULL for a customer self-service request until the shop issues the quotation */
  paper_slip_number: string | null;
  encoded_by_id: string | null;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  municipality: Municipality;
  pin_code_hash: string;
  pin_code_display: string | null;
  item_name: string;
  quantity: number;
  dimensions: string;
  wood_type: WoodType;
  color_finish: string;
  special_instructions: string | null;
  reference_photo_url: string | null;
  specs_confirmed: boolean;
  status: OrderStatus;
  priority_rank: number;
  priority_label: PriorityLabel;
  assigned_craftsman_id: string | null;
  /** NULL while a customer request awaits its official quotation */
  furniture_price: number | null;
  standard_down_payment_due: number;
  remaining_furniture_balance: number;
  delivery_fee: number;
  collectible_on_delivery: number;
  payment_exception_type: PaymentExceptionType;
  payment_exception_approved: boolean;
  estimated_completion_date: string | null; // YYYY-MM-DD; set when the quotation is issued
  scheduled_delivery_date: string | null;
  version: number;
  current_revision: number;
  approved_revision_number: number | null;
  /** presentation-only preview settings; never specification data */
  spec_preview_config: Record<string, unknown>;
  is_legacy_incomplete: boolean;
  order_origin: OrderOrigin;
  /** idempotency key of a customer self-service submission */
  client_request_key: string | null;
  created_at: string;
  updated_at: string;
}

/** Immutable row of order_specification_revisions. */
export interface SpecRevision extends StructuredSpecColumns {
  revision_id: string;
  order_id: string;
  revision_number: number;
  revision_type: RevisionType;
  wood_type: WoodType;
  color_finish: string;
  quantity: number;
  legacy_dimensions_text: string | null;
  quoted_furniture_price: number | null;
  quoted_delivery_fee: number | null;
  /** quotation validity (shop quotes only) */
  quoted_at: string | null;
  expires_at: string | null;
  spec_preview_config: Record<string, unknown>;
  changed_fields: Record<string, { from: unknown; to: unknown }> | Record<string, unknown>;
  created_by_role: string;
  created_by_id: string | null;
  created_at: string;
}

/** Columns a craftsman may see — mirrors the public.workshop_orders view. */
export interface WorkshopOrder {
  id: string;
  order_code: string;
  item_name: string;
  quantity: number;
  dimensions: string;
  wood_type: WoodType;
  color_finish: string;
  special_instructions: string | null;
  reference_photo_url: string | null;
  status: OrderStatus;
  priority_rank: number;
  priority_label: PriorityLabel;
  assigned_craftsman_id: string | null;
  estimated_completion_date: string | null;
  version: number;
  updated_at: string;
  needs_revision: boolean;
  furniture_category: FurnitureCategoryName | null;
  design_variant: string | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  custom_wood_note: string | null;
  approved_revision_number: number | null;
  is_legacy_incomplete: boolean;
}

export interface OrderConfirmation {
  id: string;
  order_id: string;
  version_number: number;
  confirmed_specs_snapshot: SpecSnapshot;
  revision_id: string;
  revision_number: number;
  confirmation_method: ConfirmationMethod;
  confirmed_by_name: string;
  recorded_by_staff_id: string | null;
  confirmed_at: string;
  /** explicit, separate acceptance semantics — recorded atomically for the same revision */
  specification_accepted_at: string;
  quotation_accepted_at: string;
  accepted_furniture_price: number;
  accepted_delivery_fee: number;
  accepted_total_amount: number;
  client_idempotency_key: string | null;
}

export interface SpecSnapshot {
  [key: string]: unknown;
  item_name: string;
  dimensions: string;
  wood_type: WoodType;
  color_finish: string;
  quantity: number;
  furniture_price: number;
}

export interface Payment {
  id: string;
  order_id: string;
  client_transaction_id: string;
  payment_type: PaymentType;
  amount: number;
  payment_method: PaymentMethod;
  collected_by_id: string | null;
  verified_by_owner_or_staff: boolean;
  notes: string | null;
  paid_at: string;
}

export interface StatusHistory {
  id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  changed_by_id: string | null;
  notes: string | null;
  client_transaction_id: string | null;
  changed_at: string;
}

export interface DeliveryAssignment {
  id: string;
  order_id: string;
  driver_id: string;
  vehicle_type: VehicleType;
  scheduled_date: string;
  time_window: string | null;
  delivery_fee: number;
  expected_collectible_amount: number;
  dispatch_status: DispatchStatus;
  failure_or_damage_notes: string | null;
  updated_at: string;
}

export interface OrderException {
  id: string;
  order_id: string;
  category: ExceptionCategory;
  description: string;
  requested_by: string | null;
  status: ExceptionStatus;
  /** while Pending, blocks confirmation and Confirmed -> In Production (always true for Spec Clarification) */
  is_production_blocking: boolean;
  resolved_by_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface NotificationLog {
  id: string;
  order_id: string;
  recipient_phone: string | null;
  channel: NotificationChannel;
  message_body: string;
  delivery_status: NotificationStatus;
  created_at: string;
}

/** Public projection for Order-ID-only lookups (no PII, no money). */
export interface CustomerTrack {
  order_code: string;
  item_name: string;
  status: OrderStatus;
  estimated_completion_date: string | null;
  scheduled_delivery_date: string | null;
  updated_at: string;
}

export interface PinResult {
  ok: boolean;
  order_id?: string;
  locked?: boolean;
  remaining_attempts?: number;
}

export interface Actor {
  id: string;
  role: Role;
  full_name: string;
  /** "demo" = role-switcher session, "auth" = Supabase-authenticated staff */
  source: "demo" | "auth";
}
