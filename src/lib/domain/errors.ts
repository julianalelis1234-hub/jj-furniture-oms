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
  | "BACKEND";

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
  ];
  for (const code of known) {
    if (message.includes(code)) return new DomainError(code, message.replace(`${code}: `, ""));
  }
  if (message.includes("orders_paper_slip_number_key"))
    return new DomainError("DUPLICATE_SLIP", "That paper slip number is already encoded in another order.");
  if (message.includes("orders_specs_gate"))
    return new DomainError("SPECS_NOT_CONFIRMED", "Customer must confirm specifications first.");
  if (pgCode === "42501" || message.includes("row-level security"))
    return new DomainError("FORBIDDEN", "You do not have permission for this action.");
  if (pgCode === "23514") return new DomainError("VALIDATION", message);
  return new DomainError("BACKEND", message);
}
