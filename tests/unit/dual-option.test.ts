import { describe, expect, it } from "vitest";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DomainError, HTTP_STATUS } from "@/lib/domain/errors";
import { roundToCurrency } from "@/lib/domain/finance";
import { isQuoteExpired, quoteValidityDays } from "@/lib/domain/gate";
import { rolesAllowedFor } from "@/lib/domain/status";
import { createCustomerRequest, customerAcceptQuote, customerOrderView } from "@/lib/services/customer";
import { reviseSpecs, startProduction, transitionOrder } from "@/lib/services/orders";
import { actors, customerAccept, payDown, seededStore } from "./helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("expected an error");
};

const request = (overrides: Record<string, unknown> = {}) => ({
  customer_name: "Josefina Lagura",
  customer_phone: "0900 000 0601",
  delivery_address: "Purok 5, Brgy. Bangcud, near the chapel",
  municipality: "Lantapan",
  customer_email: " Josefina@Example.com",
  furniture_category: "Panel Door",
  design_variant: "Classic 2-Panel",
  width_cm: "80",
  height_cm: "210",
  depth_cm: "4.5",
  wood_type: "Gmelina",
  custom_wood_note: "",
  color_finish: "Natural Varnish",
  quantity: "1",
  special_instructions: "",
  reference_photo_url: "",
  client_request_key: crypto.randomUUID(),
  website: "",
  ...overrides,
});

const quote = (overrides: Record<string, unknown> = {}) => ({
  furniture_category: "Panel Door",
  design_variant: "Classic 2-Panel",
  width_cm: "80",
  height_cm: "210",
  depth_cm: "4.5",
  wood_type: "Gmelina",
  custom_wood_note: "",
  color_finish: "Natural Varnish",
  quantity: "1",
  furniture_price: "9500",
  delivery_fee: "600",
  paper_slip_number: "S-0601",
  estimated_completion_date: "2026-12-15",
  ...overrides,
});

describe("Option 2 — customer self-service quote request", () => {
  it("an online order gets its permanent JJ code at once (also its slip no.), waits for confirmation, no price, no PIN", async () => {
    const store = await seededStore();
    const { order } = await createCustomerRequest(store, request());
    expect(order.pin_code_hash).toBeNull();
    expect(order.customer_email).toBe("josefina@example.com");
    expect(order.email_verified_at).toBeNull();
    expect(order.customer_user_id).toBeNull();
    expect(order.order_code).toMatch(new RegExp(`^JJ-${new Date().getFullYear()}-\\d{4}$`));
    expect(order.status).toBe("Waiting for Confirmation");
    expect(order.order_origin).toBe("customer_self_service");
    expect(order.furniture_price).toBeNull();
    expect(order.paper_slip_number).toBe(order.order_code); // the printable order slip
    expect(order.estimated_completion_date).toBeNull();
    expect(order.standard_down_payment_due).toBe(0);
    const [rev] = await store.listRevisions(order.id);
    expect(rev.revision_type).toBe("customer_request");
    expect(rev.quoted_furniture_price).toBeNull();
    expect(rev.expires_at).toBeNull();
    // craftsmen never see intake requests
    expect((await store.listWorkshopOrders()).some((w) => w.id === order.id)).toBe(false);
    const view = await customerOrderView(store, order.id);
    expect(view.spec_state).toBe("submitted");
    // nothing to accept yet, and production cannot be skipped to
    expect((await err(customerAccept(store, order.id, 1))).code).toBe("PENDING_REVIEW");
    expect((await err(transitionOrder(store, actors.owner, order.id, "In Production"))).code).toBe("INVALID_TRANSITION");
  });

  it("is idempotent, rate-limited per phone and rejects bots", async () => {
    const store = await seededStore();
    const key = crypto.randomUUID();
    await createCustomerRequest(store, request({ client_request_key: key }));
    expect((await err(createCustomerRequest(store, request({ client_request_key: key })))).code).toBe("DUPLICATE_REQUEST");
    await createCustomerRequest(store, request());
    await createCustomerRequest(store, request());
    expect((await err(createCustomerRequest(store, request()))).code).toBe("RATE_LIMITED");
    expect((await err(createCustomerRequest(store, request({ website: "spam", customer_phone: "09000000999" })))).code).toBe("VALIDATION");
  });

  it("after confirming, staff issue the official quotation (completion date required) -> stays Confirmed, valid QUOTE_VALIDITY_DAYS", async () => {
    const store = await seededStore();
    const { order } = await createCustomerRequest(store, request());
    await transitionOrder(store, actors.staff, order.id, "Confirmed");
    expect((await customerOrderView(store, order.id)).spec_state).toBe("awaiting_quotation");
    expect((await err(reviseSpecs(store, actors.staff, order.id, quote({ estimated_completion_date: "" }), 1))).code).toBe("VALIDATION");
    expect((await err(reviseSpecs(store, actors.craftsman, order.id, quote(), 1))).code).toBe("FORBIDDEN");
    const quoted = await reviseSpecs(store, actors.staff, order.id, quote(), 1);
    expect(quoted.status).toBe("Confirmed");
    expect(quoted.quotation_issued_at).not.toBeNull();
    expect(quoted.current_revision).toBe(2);
    expect(quoted.furniture_price).toBe(9500);
    expect(quoted.delivery_fee).toBe(600);
    expect(quoted.paper_slip_number).toBe("S-0601");
    expect(quoted.standard_down_payment_due).toBe(2850);
    const rev = (await store.listRevisions(order.id))[1];
    expect(rev.revision_type).toBe("revised_quote");
    expect(Date.parse(rev.expires_at!) - Date.parse(rev.quoted_at!)).toBe(quoteValidityDays() * 86_400_000);
    const view = await customerOrderView(store, order.id);
    expect(view.spec_state).toBe("awaiting_acceptance");
    expect(view.current?.expires_at).toBe(rev.expires_at);
    // the "choose how to pay" email is queued (no secret in it: the order page needs a login)
    const mail = (await store.listOutbox({ orderId: order.id })).find((r) => r.kind === "quotation_payment_request");
    expect(mail?.encrypted_payload ?? null).toBeNull();
  });
});

describe("atomic acceptance — accept_order_revision", () => {
  async function quotedRequest() {
    const store = await seededStore();
    const { order } = await createCustomerRequest(store, request());
    await transitionOrder(store, actors.staff, order.id, "Confirmed");
    await reviseSpecs(store, actors.staff, order.id, quote(), 1);
    const rev = (await store.listRevisions(order.id))[1];
    const base = {
      revision_id: rev.revision_id,
      expected_revision_number: 2,
      accepted_furniture_price: 9500,
      accepted_delivery_fee: 600,
      client_idempotency_key: crypto.randomUUID(),
      accept_specification: true,
      accept_quotation: true,
    };
    return { store, order, rev, base };
  }

  it("requires both explicit acceptances, the exact amounts and the latest revision", async () => {
    const { store, order, base } = await quotedRequest();
    expect((await err(customerAcceptQuote(store, order.id, { ...base, accept_quotation: false }))).code).toBe("VALIDATION");
    const mismatch = await err(customerAcceptQuote(store, order.id, { ...base, accepted_furniture_price: 9000 }));
    expect(mismatch.code).toBe("AMOUNT_MISMATCH");
    const stale = await err(customerAcceptQuote(store, order.id, { ...base, expected_revision_number: 1 }));
    expect(stale.code).toBe("STALE_REVISION");
    expect(HTTP_STATUS[stale.code]).toBe(409);
    expect(await store.listConfirmations(order.id)).toHaveLength(0);
  });

  it("an expired quotation cannot be accepted (410) until a fresh quotation is issued", async () => {
    const { store, order, rev, base } = await quotedRequest();
    const row = (store as MemoryStore).t.order_specification_revisions.find((r) => r.revision_id === rev.revision_id)!;
    row.expires_at = new Date(Date.now() - 60_000).toISOString(); // test-only backdating
    expect(isQuoteExpired(row)).toBe(true);
    expect((await customerOrderView(store, order.id)).spec_state).toBe("quote_expired");
    const e = await err(customerAcceptQuote(store, order.id, base));
    expect(e.code).toBe("QUOTE_EXPIRED");
    expect(HTTP_STATUS[e.code]).toBe(410);
    await reviseSpecs(store, actors.owner, order.id, quote(), 2);
    const o = await customerAccept(store, order.id);
    expect(o.status).toBe("Confirmed");
    expect(o.approved_revision_number).toBe(3);
  });

  it("records specification + quotation acceptance atomically and is idempotent", async () => {
    const { store, order, rev, base } = await quotedRequest();
    const first = await customerAcceptQuote(store, order.id, base);
    const replay = await customerAcceptQuote(store, order.id, base);
    expect(replay.id).toBe(first.id);
    const confs = await store.listConfirmations(order.id);
    expect(confs).toHaveLength(1);
    const [c] = confs;
    expect(c.revision_id).toBe(rev.revision_id);
    expect(c.revision_number).toBe(2);
    expect(c.specification_accepted_at).toBe(c.quotation_accepted_at);
    expect([c.accepted_furniture_price, c.accepted_delivery_fee, c.accepted_total_amount]).toEqual([9500, 600, 10100]);
    expect(first.status).toBe("Confirmed");
    expect(first.order_code).toBe(order.order_code); // the code never changes after submission
    expect(first.approved_revision_number).toBe(first.current_revision);
    // the same key for a different revision is a conflict, not a silent success
    const other = await err(customerAcceptQuote(store, order.id, { ...base, revision_id: "00000000-0000-0000-0000-000000000000" }));
    expect(other.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("Confirmed -> In Production: the verified 30% gate", () => {
  it("only verified furniture payments of at least 30% (centavo-exact) unlock production; then the spec locks", async () => {
    const store = await seededStore();
    const { order } = await createCustomerRequest(store, request());
    await transitionOrder(store, actors.staff, order.id, "Confirmed");
    await reviseSpecs(store, actors.staff, order.id, quote({ furniture_price: "9999.99" }), 1);
    await customerAccept(store, order.id);
    const due = roundToCurrency(9999.99 * 0.3);
    expect(due).toBe(3000);
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    // a delivery-fee payment does not count toward the furniture down payment
    await store.insertPayment({
      order_id: order.id, client_transaction_id: crypto.randomUUID(), payment_type: "Delivery Fee", amount: 600,
      payment_method: "Cash", collected_by_id: null, verified_by_owner_or_staff: true, notes: null, paid_at: new Date().toISOString(),
    });
    // unverified cash does not count either
    await store.insertPayment({
      order_id: order.id, client_transaction_id: crypto.randomUUID(), payment_type: "Down Payment (30%)", amount: 3000,
      payment_method: "Cash", collected_by_id: null, verified_by_owner_or_staff: false, notes: null, paid_at: new Date().toISOString(),
    });
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    await payDown(store, order.id, 2999.99);
    expect((await err(startProduction(store, actors.owner, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    await payDown(store, order.id, 0.01);
    const o = await startProduction(store, actors.staff, order.id);
    expect(o.status).toBe("In Production");
    expect(o.remaining_furniture_balance).toBe(6999.99);
    expect((await customerOrderView(store, order.id)).spec_state).toBe("locked");
    expect((await err(store.updateOrder(order.id, { delivery_fee: 900 }))).code).toBe("SPEC_LOCKED");
  });

  it("role permissions follow the spec", () => {
    expect(rolesAllowedFor("Confirmed", "In Production")).toEqual(["owner", "staff"]);
    expect(rolesAllowedFor("In Production", "Completed / For Inspection")).toContain("craftsman");
    expect(rolesAllowedFor("Completed / For Inspection", "Ready for Delivery")).toEqual(["owner"]);
    expect(rolesAllowedFor("Quote Requested", "Waiting for Confirmation")).toEqual(["owner", "staff"]);
  });
});

describe("append-only payments ledger", () => {
  it("allows verification and appended notes only", async () => {
    const store = await seededStore();
    const p = (await store.listPayments()).find((x) => !x.verified_by_owner_or_staff)!;
    expect((await err(store.updatePayment(p.id, { amount: 1 }))).code).toBe("IMMUTABLE_RECORD");
    const v = await store.updatePayment(p.id, { verified_by_owner_or_staff: true, notes: `${p.notes ?? ""} · verified` });
    expect(v.verified_by_owner_or_staff).toBe(true);
    expect((await err(store.updatePayment(p.id, { verified_by_owner_or_staff: false }))).code).toBe("IMMUTABLE_RECORD");
  });
});
