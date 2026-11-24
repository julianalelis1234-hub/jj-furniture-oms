export type DomainErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_TRANSITION"
  | "SPECS_NOT_CONFIRMED"
  | "DOWN_PAYMENT_REQUIRED"
  | "OWNER_ONLY"
  | "DUPLICATE_SLIP"
  | "VERSION_CONFLICT"
  | "RATE_LIMITED"
  | "STALE_REVISION"
  | "PENDING_REVIEW"
  | "SPEC_LOCKED"
  | "SPEC_SNAPSHOT_MISMATCH"
  | "QUOTE_EXPIRED"
  | "AMOUNT_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "DUPLICATE_REQUEST"
  | "IMMUTABLE_RECORD"
  | "INVALID_REVISION"
  | "ALREADY_ACCEPTED"
  | "BACKEND";

/** HTTP-style status for API callers (409 stale, 410 expired quote, ...). */
export const HTTP_STATUS: Partial<Record<DomainErrorCode, number>> = {
  VALIDATION: 400,
  AMOUNT_MISMATCH: 400,
  FORBIDDEN: 403,
  OWNER_ONLY: 403,
  IMMUTABLE_RECORD: 403,
  NOT_FOUND: 404,
  STALE_REVISION: 409,
  ALREADY_ACCEPTED: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DUPLICATE_SLIP: 409,
  DUPLICATE_REQUEST: 409,
  QUOTE_EXPIRED: 410,
  PENDING_REVIEW: 422,
  SPECS_NOT_CONFIRMED: 422,
  DOWN_PAYMENT_REQUIRED: 422,
  SPEC_LOCKED: 422,
  SPEC_SNAPSHOT_MISMATCH: 422,
  INVALID_TRANSITION: 422,
  INVALID_REVISION: 422,
  RATE_LIMITED: 429,
};

export class DomainError extends Error {
  constructor(
    public code: DomainErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Maps Postgres trigger/constraint messages (see 001_init.sql) to domain errors. */
export function fromPostgresMessage(message: string, pgCode?: string): DomainError {
  const known: DomainErrorCode[] = [
    "INVALID_TRANSITION",
    "SPECS_NOT_CONFIRMED",
    "DOWN_PAYMENT_REQUIRED",
    "OWNER_ONLY",
    "STALE_REVISION",
    "PENDING_REVIEW",
    "SPEC_LOCKED",
    "SPEC_SNAPSHOT_MISMATCH",
    "QUOTE_EXPIRED",
    "AMOUNT_MISMATCH",
    "IDEMPOTENCY_CONFLICT",
    "IMMUTABLE_RECORD",
    "INVALID_REVISION",
    "ALREADY_ACCEPTED",
  ];
  for (const code of known) {
    if (message.includes(code)) return new DomainError(code, message.replace(`${code}: `, ""));
  }
  if (message.includes("orders_client_request_key_uidx"))
    return new DomainError("DUPLICATE_REQUEST", "This request was already submitted.");
  if (message.includes("orders_quote_fields_required"))
    return new DomainError("VALIDATION", "A quotation needs a price, a paper slip number and an estimated completion date.");
  if (message.includes("payments_online_reference_chk"))
    return new DomainError("VALIDATION", "Online and bank payments need the transaction reference number.");
  if (message.includes("payments_rejection_chk"))
    return new DomainError("VALIDATION", "Give a reason for rejecting the payment.");
  if (message.includes("orders_paper_slip_number_key"))
    return new DomainError("DUPLICATE_SLIP", "That paper slip number is already encoded in another order.");
  if (message.includes("orders_other_wood_note")) return new DomainError("VALIDATION", "Describe the wood when \"Other\" is selected.");
  if (message.includes("_range") || message.includes("orders_structured_spec_required"))
    return new DomainError("VALIDATION", "Category, design and dimensions (0–1000 cm) are required.");
  if (message.startsWith("VALIDATION: ")) return new DomainError("VALIDATION", message.slice(12));
  if (message.startsWith("FORBIDDEN: ")) return new DomainError("FORBIDDEN", message.slice(11));
  if (message.startsWith("NOT_FOUND: ")) return new DomainError("NOT_FOUND", message.slice(11));
  if (message.includes("orders_specs_gate"))
    return new DomainError("SPECS_NOT_CONFIRMED", "Customer must confirm specifications first.");
  if (pgCode === "42501" || message.includes("row-level security"))
    return new DomainError("FORBIDDEN", "You do not have permission for this action.");
  if (pgCode === "23514") return new DomainError("VALIDATION", message);
  return new DomainError("BACKEND", message);
}
