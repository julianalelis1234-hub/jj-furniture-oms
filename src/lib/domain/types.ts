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

export const ORDER_STATUSES = [
  "Waiting for Confirmation",
  "Confirmed",
  "In Production",
  "Completed / For Inspection",
  "Ready for Delivery",
  "Out for Delivery",
  "Delivered",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

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

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  order_code: string;
  paper_slip_number: string;
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
  furniture_price: number;
  standard_down_payment_due: number;
  remaining_furniture_balance: number;
  delivery_fee: number;
  collectible_on_delivery: number;
  payment_exception_type: PaymentExceptionType;
  payment_exception_approved: boolean;
  estimated_completion_date: string; // YYYY-MM-DD
  scheduled_delivery_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
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
  estimated_completion_date: string;
  version: number;
  updated_at: string;
  needs_revision: boolean;
}

export interface OrderConfirmation {
  id: string;
  order_id: string;
  version_number: number;
  confirmed_specs_snapshot: SpecSnapshot;
  confirmation_method: ConfirmationMethod;
  confirmed_by_name: string;
  recorded_by_staff_id: string | null;
  confirmed_at: string;
}

export interface SpecSnapshot {
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
  estimated_completion_date: string;
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
