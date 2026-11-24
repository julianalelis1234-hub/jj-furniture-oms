import { z } from "zod";
import { CATALOG, FINISHES, FURNITURE_CATEGORIES } from "./furniture";
import {
  CONFIRMATION_METHODS,
  EXCEPTION_CATEGORIES,
  MUNICIPALITIES,
  PAYMENT_EXCEPTION_TYPES,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  PRIORITY_LABELS,
  VEHICLE_TYPES,
  WOOD_TYPES,
} from "./types";

const required = (label: string) => z.string().trim().min(1, { error: `${label} is required.` });
const isoDate = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: `${label} must be a valid date.` });
const pesos = (label: string) =>
  z.coerce.number({ error: `${label} must be a number.` }).finite().nonnegative({ error: `${label} cannot be negative.` });

const cm = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .finite()
    .gt(0, { error: `${label} must be more than 0 cm.` })
    .max(1000, { error: `${label} must be at most 1000 cm.` });

/** The authoritative structured specification (configurator). */
export const furnitureSpecShape = {
  furniture_category: z.enum(FURNITURE_CATEGORIES, { error: "Choose a furniture category." }),
  design_variant: required("Design"),
  width_cm: cm("Width"),
  height_cm: cm("Height"),
  depth_cm: cm("Depth"),
  wood_type: z.enum(WOOD_TYPES, { error: "Choose a wood type." }),
  custom_wood_note: z.string().trim().max(120).optional().default(""),
  color_finish: z.enum(FINISHES, { error: "Choose a finish." }),
  quantity: z.coerce.number().int({ error: "Quantity must be a whole number." }).positive({ error: "Quantity must be at least 1." }),
};
export function refineSpec(v: { furniture_category: string; design_variant: string; wood_type: string; custom_wood_note?: string }, ctx: z.RefinementCtx) {
  if (v.wood_type === "Other" && !v.custom_wood_note?.trim()) {
    ctx.addIssue({ code: "custom", path: ["custom_wood_note"], message: 'Describe the wood when "Other" is selected.' });
  }
  const cat = CATALOG[v.furniture_category as keyof typeof CATALOG];
  if (cat && !cat.variants.includes(v.design_variant)) {
    ctx.addIssue({ code: "custom", path: ["design_variant"], message: `Choose a ${v.furniture_category} design.` });
  }
}
export const furnitureSpecSchema = z.object(furnitureSpecShape).superRefine(refineSpec);
export type FurnitureSpecInput = z.infer<typeof furnitureSpecSchema>;

/** Normalized email (trim + lower case); the stored form is always normalized. */
export const emailField = (label = "Email") =>
  z.string().trim().toLowerCase().max(254).pipe(z.email({ error: `${label}: enter a valid email address, e.g. name@example.com.` }));
/** Checkbox / boolean from a form ("on", "true") */
const checkbox = z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true");

/** Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX */
export const PH_PHONE = /^(09\d{9}|\+639\d{9})$/;

export const newOrderSchema = z
  .object({
    paper_slip_number: required("Paper Slip #").max(40),
    encoded_by_id: z.uuid({ error: "Choose who encoded this slip." }),
    customer_name: required("Customer name").max(120),
    customer_phone: z
      .string()
      .trim()
      .transform((s) => s.replace(/[\s-]/g, ""))
      .pipe(z.string().regex(PH_PHONE, { error: "Use a PH mobile number, e.g. 09XX XXX XXXX." })),
    delivery_address: required("Delivery address").max(300),
    municipality: z.enum(MUNICIPALITIES, { error: "Choose a municipality." }),
    /** Option 1: customer email, or the explicit Walk-In / No Email (paper slip only) toggle */
    customer_email: z.string().trim().toLowerCase().max(254).optional().default(""),
    has_no_email: checkbox,
    item_name: z.string().trim().max(120).optional().default(""),
    ...furnitureSpecShape,
    special_instructions: z.string().trim().max(1000).optional().default(""),
    reference_photo_url: z
      .union([z.literal(""), z.url({ error: "Reference photo must be a link (https://…)." })])
      .optional()
      .default(""),
    furniture_price: z.coerce
      .number({ error: "Price must be a number." })
      .finite()
      .positive({ error: "Furniture price must be greater than ₱0." })
      .max(99_999_999),
    delivery_fee: pesos("Delivery fee").max(999_999).default(0),
    payment_exception_type: z.enum(PAYMENT_EXCEPTION_TYPES).default("Standard 30/70"),
    estimated_completion_date: isoDate("Estimated completion date"),
    scheduled_delivery_date: z.union([z.literal(""), isoDate("Scheduled delivery date")]).optional().default(""),
  })
  .superRefine((v, ctx) => {
    refineSpec(v, ctx);
    refineEmailOrWalkIn(v, ctx);
    if (v.municipality !== "Valencia City" && v.delivery_fee <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["delivery_fee"],
        message: "Enter the distance-based delivery fee for deliveries outside Valencia City.",
      });
    }
    if (v.scheduled_delivery_date && v.scheduled_delivery_date < v.estimated_completion_date) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduled_delivery_date"],
        message: "Delivery cannot be scheduled before the estimated completion date.",
      });
    }
  });
export type NewOrderInput = z.infer<typeof newOrderSchema>;

/** Either a valid customer email or the walk-in toggle — never both, never neither. */
export function refineEmailOrWalkIn(v: { customer_email: string; has_no_email: boolean }, ctx: z.RefinementCtx) {
  if (v.has_no_email) {
    if (v.customer_email) ctx.addIssue({ code: "custom", path: ["customer_email"], message: "Clear the email for a Walk-In / No Email order." });
    return;
  }
  if (!v.customer_email) {
    ctx.addIssue({ code: "custom", path: ["customer_email"], message: "Enter the customer's email, or tick Walk-In / No Email (paper slip only)." });
    return;
  }
  if (!emailField().safeParse(v.customer_email).success)
    ctx.addIssue({ code: "custom", path: ["customer_email"], message: "Enter a valid email address, e.g. name@example.com." });
}

export const editOrderSchema = z.object({
  customer_email: z.string().trim().toLowerCase().max(254).optional().default(""),
  has_no_email: checkbox,
  customer_phone: z.string().trim().transform((s) => s.replace(/[\s-]/g, "")).pipe(z.string().regex(PH_PHONE, { error: "Use a PH mobile number, e.g. 09XX XXX XXXX." })),
  delivery_address: required("Delivery address").max(300),
  municipality: z.enum(MUNICIPALITIES),
  delivery_fee: pesos("Delivery fee"),
  special_instructions: z.string().trim().max(1000).optional().default(""),
  reference_photo_url: z.union([z.literal(""), z.url()]).optional().default(""),
  estimated_completion_date: isoDate("Estimated completion date"),
  scheduled_delivery_date: z.union([z.literal(""), isoDate("Scheduled delivery date")]).optional().default(""),
}).superRefine((v, ctx) => {
  // edits: never both; "neither" is checked in the service (allowed only for legacy rows recorded before emails)
  if (v.has_no_email && v.customer_email) ctx.addIssue({ code: "custom", path: ["customer_email"], message: "Clear the email for a Walk-In / No Email order." });
  else if (v.customer_email && !emailField().safeParse(v.customer_email).success)
    ctx.addIssue({ code: "custom", path: ["customer_email"], message: "Enter a valid email address, e.g. name@example.com." });
});

/**
 * Staff/owner quotation (revised_quote): full spec + price (+ provincial fee).
 * Quoting a customer self-service request also needs the paper slip number and
 * the estimated completion date (both optional for orders that already have them).
 */
export const specRevisionSchema = z
  .object({
    ...furnitureSpecShape,
    // staff may keep a finish already written on the order, even if it is not one of the configurator's four
    color_finish: z.string().trim().min(2, { error: "Choose a finish." }).max(60),
    furniture_price: z.coerce.number().positive({ error: "Furniture price must be greater than ₱0." }).max(99_999_999),
    delivery_fee: pesos("Delivery fee").max(999_999).default(0),
    paper_slip_number: z.string().trim().max(40).optional().default(""),
    estimated_completion_date: z.union([z.literal(""), isoDate("Estimated completion date")]).optional().default(""),
  })
  .superRefine(refineSpec);

/** Option 2 — customer self-service quote request (no price; the shop quotes it). */
export const customerRequestSchema = z
  .object({
    customer_name: required("Your name").max(120),
    customer_phone: z
      .string()
      .trim()
      .transform((s) => s.replace(/[\s-]/g, ""))
      .pipe(z.string().regex(PH_PHONE, { error: "Use a PH mobile number, e.g. 09XX XXX XXXX." })),
    delivery_address: required("Delivery address").min(12, { error: "Add the purok / barangay and a landmark so the driver can find you." }).max(300),
    /** Option 2: required — the quotation review link is sent here */
    customer_email: emailField("Email"),
    municipality: z.enum(MUNICIPALITIES, { error: "Choose a municipality." }),
    ...furnitureSpecShape,
    special_instructions: z.string().trim().max(1000).optional().default(""),
    reference_photo_url: z
      .union([z.literal(""), z.url({ error: "Reference photo must be a link (https://…)." })])
      .optional()
      .default(""),
    client_request_key: z.string().trim().min(8).max(100),
    /** honeypot: real people never fill this hidden field */
    website: z.string().max(0, { error: "Request rejected." }).optional().default(""),
  })
  .superRefine(refineSpec);
export type CustomerRequestInput = z.infer<typeof customerRequestSchema>;

/** Customer proposal: spec only (customers never set prices). */
export const customerProposalSchema = furnitureSpecSchema;

export const confirmationSchema = z.object({
  order_id: z.uuid(),
  confirmation_method: z.enum(CONFIRMATION_METHODS),
  confirmed_by_name: required("Name of the person who confirmed"),
});

export const paymentSchema = z.object({
  order_id: z.uuid(),
  client_transaction_id: z.uuid(),
  payment_type: z.enum(PAYMENT_TYPES),
  amount: z.coerce.number().finite().positive({ error: "Amount must be greater than ₱0." }),
  payment_method: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(500).optional().default(""),
});

export const deliveryScheduleSchema = z.object({
  order_id: z.uuid(),
  driver_id: z.uuid({ error: "Choose a driver." }),
  vehicle_type: z.enum(VEHICLE_TYPES, { error: "Choose a vehicle." }),
  scheduled_date: isoDate("Delivery date"),
  time_window: required("Time window").max(60),
});

export const exceptionRequestSchema = z.object({
  order_id: z.uuid(),
  category: z.enum(EXCEPTION_CATEGORIES),
  description: required("Description").max(1000),
});

export const prioritySchema = z.object({
  order_id: z.uuid(),
  priority_label: z.enum(PRIORITY_LABELS),
});

export function firstErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export const customerLoginSchema = z.object({
  email: emailField(),
  password: z.string().min(1, { error: "Enter your password." }).max(128),
});
