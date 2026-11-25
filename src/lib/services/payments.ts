import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import { money } from "@/lib/domain/finance";
import { REFERENCE_PAYMENT_METHODS, type Actor, type Order, type PaymentMethod, type PaymentType } from "@/lib/domain/types";
import { paymentSchema } from "@/lib/domain/validation";
import { ensureRole } from "./guard";
import { notifyCustomer } from "./notify";
import { mustGetOrder } from "./orders";

/** Office-logged payments (in person / GCash screenshot) are verified immediately. */
export async function logPayment(store: DataStore, actor: Actor, raw: unknown) {
  ensureRole(actor, ["owner", "staff"], "log payments");
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", parsed.error);
  const v = parsed.data;
  const order = await mustGetOrder(store, v.order_id);
  const owed = v.payment_type === "Delivery Fee" ? order.delivery_fee : order.remaining_furniture_balance;
  if (v.amount > owed + 0.001) {
    throw new DomainError("VALIDATION", `Amount exceeds what is still owed (₱${owed.toLocaleString("en-PH")}).`);
  }
  const { payment, duplicate } = await store.insertPayment({
    order_id: v.order_id,
    client_transaction_id: v.client_transaction_id,
    payment_type: v.payment_type,
    amount: v.amount,
    payment_method: v.payment_method,
    collected_by_id: actor.id,
    verified_by_owner_or_staff: true,
    notes: v.notes || null,
    paid_at: new Date().toISOString(),
  });
  return { payment, duplicate, order: await mustGetOrder(store, v.order_id) };
}

/** Driver cash is counted at the shop before it reduces the balance. */
export async function verifyCashHandover(store: DataStore, actor: Actor, paymentId: string, note?: string) {
  ensureRole(actor, ["owner", "staff"], "verify cash handovers");
  const payment = (await store.listPayments()).find((p) => p.id === paymentId);
  if (!payment) throw new DomainError("NOT_FOUND", "Payment not found.");
  if (payment.verified_by_owner_or_staff) return payment;
  return store.updatePayment(paymentId, {
    verified_by_owner_or_staff: true,
    notes: [payment.notes, `Handover verified by ${actor.full_name}${note ? `: ${note}` : ""}`].filter(Boolean).join(" · "),
  });
}

// ------------------------------------------------- customer-submitted payments (009) ----
/** Where proof-of-payment files live: a private bucket, read only through the server. */
export interface ProofStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": { ext: "webp", magic: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
  "application/pdf": { ext: "pdf", magic: (b) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-" },
};

/** A photo of the customer's room (taken in AR or with the camera): images only, checked by its first bytes. */
export function checkRoomPhoto(file: { bytes: Uint8Array; type: string; size: number }): { ext: string } {
  if (file.size > PROOF_MAX_BYTES) throw new DomainError("VALIDATION", "The room photo is larger than 5 MB. Choose a smaller photo.");
  const t = PROOF_TYPES[file.type];
  if (!t || file.type === "application/pdf" || !t.magic(file.bytes)) throw new DomainError("VALIDATION", "The room photo must be a JPG, PNG or WebP image.");
  return { ext: t.ext };
}

/** Checks the declared type AND the file's own first bytes, so a renamed file is refused. */
export function checkProof(file: { bytes: Uint8Array; type: string; size: number }): { ext: string } {
  if (file.size === 0) throw new DomainError("VALIDATION", "Attach a photo or PDF of your receipt.");
  if (file.size > PROOF_MAX_BYTES) throw new DomainError("VALIDATION", "The receipt file is larger than 5 MB. Take a smaller photo or screenshot.");
  const t = PROOF_TYPES[file.type];
  if (!t || !t.magic(file.bytes)) throw new DomainError("VALIDATION", "The receipt must be a JPG, PNG, WebP or PDF file.");
  return { ext: t.ext };
}

export interface CustomerPaymentInput {
  order_code: string;
  client_transaction_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference_number: string;
  proof: { bytes: Uint8Array; type: string; size: number } | null;
}

/** The ledger type of the next customer payment, from the chosen plan and what is already verified. */
export function customerPaymentType(order: Pick<Order, "payment_plan">, verifiedFurniture: number): PaymentType {
  if (order.payment_plan === "full") return "Full Payment";
  if (order.payment_plan === "down_30" && verifiedFurniture === 0) return "Down Payment (30%)";
  return "Installment / Partial";
}

/**
 * A signed-in customer submits an online / bank payment for THEIR OWN accepted
 * order: amount, reference number and a receipt photo. It is saved UNVERIFIED and
 * counts toward nothing until staff verify it. Idempotent on client_transaction_id.
 * Cash is paid at the shop and logged by staff (logPayment).
 */
export async function submitCustomerPayment(customerStore: DataStore, userId: string, raw: CustomerPaymentInput, proofs: ProofStore) {
  const o = await customerStore.getOrderByCode(raw.order_code); // RLS-filtered in production
  if (!o || o.customer_user_id !== userId) throw new DomainError("NOT_FOUND", "Order not found.");
  const store = customerStore.elevated();
  if (!o.specs_confirmed || !["Confirmed", "In Production", "Completed / For Inspection", "Ready for Delivery", "Out for Delivery"].includes(o.status))
    throw new DomainError("VALIDATION", "Accept the quotation first, then submit your payment.");
  if (!REFERENCE_PAYMENT_METHODS.includes(raw.payment_method))
    throw new DomainError("VALIDATION", "Choose online payment (GCash / Maya) or bank transfer. Cash is paid at the shop.");
  const amount = money(Number(raw.amount));
  if (!(amount > 0)) throw new DomainError("VALIDATION", "Enter the amount you paid.");
  if (amount > o.remaining_furniture_balance + 0.001)
    throw new DomainError("VALIDATION", `That is more than your remaining balance of ₱${o.remaining_furniture_balance.toLocaleString("en-PH")}.`);
  const ref = raw.reference_number.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9 #./-]{3,60}$/.test(ref)) throw new DomainError("VALIDATION", "Enter the reference number from your GCash, Maya or bank receipt.");
  if (!/^[0-9a-f-]{36}$/i.test(raw.client_transaction_id)) throw new DomainError("VALIDATION", "Please reload the page and try again.");

  const existing = await store.listPayments(o.id);
  const replay = existing.find((p) => p.client_transaction_id === raw.client_transaction_id);
  if (replay) return { payment: replay, duplicate: true };
  if (existing.filter((p) => !p.verified_by_owner_or_staff && !p.rejected_at && p.submitted_by === userId).length >= 3)
    throw new DomainError("RATE_LIMITED", "You already have payments waiting for the shop to check. Please wait for them first.");
  if (!raw.proof) throw new DomainError("VALIDATION", "Attach a photo or PDF of your receipt.");
  const { ext } = checkProof(raw.proof);
  const path = `${o.order_code}/${crypto.randomUUID()}.${ext}`; // never derived from the uploaded file name
  await proofs.put(path, raw.proof.bytes, raw.proof.type);

  const verified = existing.filter((p) => p.verified_by_owner_or_staff && p.payment_type !== "Delivery Fee").reduce((s, p) => s + p.amount, 0);
  const { payment, duplicate } = await store.insertPayment({
    order_id: o.id,
    client_transaction_id: raw.client_transaction_id,
    payment_type: customerPaymentType(o, verified),
    amount,
    payment_method: raw.payment_method,
    collected_by_id: null,
    verified_by_owner_or_staff: false,
    notes: null,
    paid_at: new Date().toISOString(),
    reference_number: ref,
    proof_path: path,
    submitted_by: userId,
  });
  if (!duplicate)
    await store.insertNotification({
      order_id: o.id, recipient_phone: null, channel: "In-App", delivery_status: "Sent", created_at: new Date().toISOString(),
      message_body: `Staff/Owner: ${o.customer_name} submitted a ${raw.payment_method} payment of ₱${amount.toLocaleString("en-PH")} for ${o.order_code} (ref. ${ref}). Check it, then verify or reject it.`,
    });
  return { payment, duplicate };
}

/** Staff/owner verify a payment (customer submission or driver cash). Only verified payments count. */
export async function verifyPayment(store: DataStore, actor: Actor, paymentId: string, note?: string) {
  ensureRole(actor, ["owner", "staff"], "verify payments");
  const payment = (await store.listPayments()).find((p) => p.id === paymentId);
  if (!payment) throw new DomainError("NOT_FOUND", "Payment not found.");
  if (payment.verified_by_owner_or_staff) return payment;
  if (payment.rejected_at) throw new DomainError("IMMUTABLE_RECORD", "This payment was rejected. Ask the customer to submit it again.");
  return store.updatePayment(paymentId, {
    verified_by_owner_or_staff: true,
    notes: [payment.notes, `Verified by ${actor.full_name}${note?.trim() ? `: ${note.trim()}` : ""}`].filter(Boolean).join(" · "),
  });
}

/** Staff/owner reject a customer submission (e.g. the reference number is not in GCash). Once, with a reason. */
export async function rejectPayment(store: DataStore, actor: Actor, paymentId: string, reason: string) {
  ensureRole(actor, ["owner", "staff"], "reject payments");
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw new DomainError("VALIDATION", "Tell the customer why the payment was not accepted.");
  if (why.length > 300) throw new DomainError("VALIDATION", "Keep the reason under 300 characters.");
  const payment = (await store.listPayments()).find((p) => p.id === paymentId);
  if (!payment) throw new DomainError("NOT_FOUND", "Payment not found.");
  if (payment.verified_by_owner_or_staff) throw new DomainError("IMMUTABLE_RECORD", "A verified payment cannot be rejected.");
  if (payment.rejected_at) return payment;
  const updated = await store.updatePayment(paymentId, { rejected_at: new Date().toISOString(), rejected_by_id: actor.id, rejection_reason: why });
  const order = await mustGetOrder(store, payment.order_id);
  await notifyCustomer(store, order,
    `JJ Enterprises: your payment of ₱${payment.amount.toLocaleString("en-PH")} for ${order.order_code} (ref. ${payment.reference_number ?? "-"}) was not accepted: ${why}. Please check it and submit it again.`);
  return updated;
}
