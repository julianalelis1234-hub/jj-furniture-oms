import { describe, expect, it } from "vitest";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DEMO_CUSTOMER_LOGIN } from "@/lib/data/seed";
import { DomainError } from "@/lib/domain/errors";
import { customerOrderView, createCustomerRequest } from "@/lib/services/customer";
import { demoCompletePassword, demoCustomerAuth } from "@/lib/services/customer-auth";
import { customerDashboard, customerOwnedAccept, customerOwnedOrder } from "@/lib/services/customer-portal";
import { confirmOrder, createOrder, reviseSpecs, startProduction } from "@/lib/services/orders";
import { checkProof, rejectPayment, submitCustomerPayment, verifyPayment, type ProofStore } from "@/lib/services/payments";
import { actors, seededStore, validOrderInput } from "./helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("expected an error");
};

const mailbox = (store: MemoryStore, to: string) => store.t.demo_mailbox.filter((m) => m.to === to);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const proofs = (): ProofStore & { files: Map<string, Uint8Array> } => {
  const files = new Map<string, Uint8Array>();
  return { files, async put(p, b) { files.set(p, b); }, async get(p) { const b = files.get(p); return b ? { bytes: b, contentType: "image/jpeg" } : null; } };
};
const quote = (price = "20000") => ({ ...validOrderInput(), furniture_price: price });

/** Online order -> shop confirms (create-password email) -> customer sets a password -> quotation issued. */
async function confirmedOnlineOrder(email = "rosa.daguman@example.com") {
  const store = (await seededStore()) as MemoryStore;
  const auth = demoCustomerAuth(store);
  const { order } = await createCustomerRequest(store, {
    customer_name: "Rosa Daguman", customer_phone: "0900 000 0711", customer_email: email,
    delivery_address: "Purok 3, Poblacion, near the plaza", municipality: "Valencia City",
    furniture_category: "Dining Table", design_variant: "4-Seater Rectangular", width_cm: "120", height_cm: "76", depth_cm: "80",
    wood_type: "Mahogany", custom_wood_note: "", color_finish: "Walnut Stain", quantity: "1", special_instructions: "", reference_photo_url: "",
    client_request_key: crypto.randomUUID(), website: "",
  });
  const { provisioning } = await confirmOrder(store, actors.staff, auth, order.id);
  return { store, auth, order: (await store.getOrder(order.id))!, email, provisioning };
}

describe("confirm -> create password -> claim", () => {
  it("confirming a new customer's order emails a create-password link; the order links only once they sign in", async () => {
    const { store, order, email, provisioning } = await confirmedOnlineOrder();
    expect(order.status).toBe("Confirmed");
    expect(order.confirmed_at).not.toBeNull();
    expect(provisioning).toMatchObject({ status: "setup_email_sent", new_account: true });
    const acct = store.t.customer_accounts.find((a) => a.email === email)!;
    expect(acct.password_hash).toBeNull(); // never a generated / emailed password
    expect(order.customer_user_id).toBeNull(); // the inbox is not proven yet
    expect(await customerDashboard(store, acct.id)).toHaveLength(0); // no password yet: nothing is claimed
    const mail = mailbox(store, email).find((m) => m.subject.includes("create your JJ Enterprises password"))!;
    const token = mail.text.match(/set-password\?token=([A-Za-z0-9_-]+)/)![1];
    await demoCompletePassword(store, token, "Narra-Table-2026");
    const dash = await customerDashboard(store, acct.id);
    expect(dash.map((d) => d.view.order_code)).toEqual([order.order_code]);
    const linked = (await store.getOrder(order.id))!;
    expect(linked.customer_user_id).toBe(acct.id);
    expect(linked.email_verified_at).not.toBeNull();
    expect(linked.provisioning_status).toBe("linked");
  });

  it("a returning customer gets a log-in email; their password is untouched and the order appears after sign-in", async () => {
    const store = (await seededStore()) as MemoryStore;
    const maria = store.t.customer_accounts.find((a) => a.email === DEMO_CUSTOMER_LOGIN.email)!;
    const before = maria.password_hash;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: DEMO_CUSTOMER_LOGIN.email }));
    expect(mailbox(store, DEMO_CUSTOMER_LOGIN.email)).toHaveLength(0); // nothing before confirmation
    const { provisioning } = await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id);
    expect(provisioning).toMatchObject({ new_account: false });
    expect(maria.password_hash).toBe(before);
    expect(mailbox(store, DEMO_CUSTOMER_LOGIN.email)[0].text).toMatch(/Your password was not changed/);
    expect((await customerDashboard(store, maria.id)).map((d) => d.view.order_code)).toContain(order.order_code);
  });

  it("a walk-in order has no email, no account and no portal", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: "", has_no_email: "on" }));
    const { provisioning } = await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id);
    expect(provisioning.status).toBe("not_applicable");
    expect(store.t.notification_outbox.some((r) => r.order_id === order.id)).toBe(false);
  });

  it("only staff/owner confirm, and only a waiting order", async () => {
    const { store, auth, order } = await confirmedOnlineOrder();
    expect((await err(confirmOrder(store, actors.craftsman, auth, order.id))).code).toBe("FORBIDDEN");
    expect((await err(confirmOrder(store, actors.staff, auth, order.id))).code).toBe("INVALID_TRANSITION");
  });
});

describe("quotation -> accept with payment terms", () => {
  it("issuing the quotation keeps the order Confirmed and emails a 'choose how to pay' link to the login-protected order page", async () => {
    const { store, order, email } = await confirmedOnlineOrder();
    const q = await reviseSpecs(store, actors.staff, order.id, quote(), order.current_revision);
    expect(q.status).toBe("Confirmed");
    expect(q.quotation_issued_at).not.toBeNull();
    const mail = mailbox(store, email).find((m) => m.subject.startsWith("Quotation for"))!;
    expect(mail.text).toContain(`/customer/orders/${order.order_code}`);
    expect(mail.text).not.toMatch(/token=/); // no secret: the page requires the customer's own login
  });

  it("the signed-in customer accepts their own quotation with installment terms; the owner approval is queued", async () => {
    const { store, order, email } = await confirmedOnlineOrder();
    await reviseSpecs(store, actors.staff, order.id, quote(), order.current_revision);
    const acct = store.t.customer_accounts.find((a) => a.email === email)!;
    const token = mailbox(store, email).find((m) => m.text.includes("set-password?token="))!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    await demoCompletePassword(store, token, "Narra-Table-2026");
    const { view } = await customerOwnedOrder(store, acct.id, order.order_code);
    expect(view.spec_state).toBe("awaiting_acceptance");
    const input = {
      expected_revision_number: view.current!.revision_number, accepted_furniture_price: 20000, accepted_delivery_fee: 0,
      client_idempotency_key: crypto.randomUUID(), accept_specification: true, accept_quotation: true,
      payment_plan: "installment" as const, payment_method: "Bank Transfer" as const,
    };
    // someone else's account cannot accept it
    const maria = store.t.customer_accounts.find((a) => a.email === DEMO_CUSTOMER_LOGIN.email)!;
    expect((await err(customerOwnedAccept(store, maria.id, order.order_code, input))).code).toBe("NOT_FOUND");
    expect((await store.listWorkshopOrders()).some((w) => w.id === order.id)).toBe(false); // craftsmen do not see an open quotation
    const accepted = await customerOwnedAccept(store, acct.id, order.order_code, input);
    expect((await store.listWorkshopOrders()).some((w) => w.id === order.id)).toBe(true); // accepted: "Up next" in the workshop
    expect(accepted.status).toBe("Confirmed");
    expect(accepted.payment_plan).toBe("installment");
    expect(accepted.preferred_payment_method).toBe("Bank Transfer");
    expect(accepted.payment_exception_type).toBe("Installment");
    expect((await store.listExceptions(order.id)).some((e) => e.category === "Installment Approval" && e.status === "Pending")).toBe(true);
    expect((await customerOrderView(store, order.id)).spec_state).toBe("accepted");
    expect((await err(customerOwnedAccept(store, acct.id, order.order_code, { ...input, client_idempotency_key: crypto.randomUUID() }))).code).toBe("ALREADY_ACCEPTED");
  });
});

describe("customer payments: reference no. + receipt, verified by staff", () => {
  async function acceptedOrder() {
    const ctx = await confirmedOnlineOrder();
    const { store, order, email } = ctx;
    await reviseSpecs(store, actors.staff, order.id, quote(), order.current_revision);
    const acct = store.t.customer_accounts.find((a) => a.email === email)!;
    const token = mailbox(store, email).find((m) => m.text.includes("set-password?token="))!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    await demoCompletePassword(store, token, "Narra-Table-2026");
    const { view } = await customerOwnedOrder(store, acct.id, order.order_code);
    await customerOwnedAccept(store, acct.id, order.order_code, {
      expected_revision_number: view.current!.revision_number, accepted_furniture_price: 20000, accepted_delivery_fee: 0,
      client_idempotency_key: crypto.randomUUID(), accept_specification: true, accept_quotation: true,
      payment_plan: "down_30", payment_method: "Online Payment (GCash / Maya)",
    });
    return { ...ctx, acct };
  }
  const pay = (code: string, o: Record<string, unknown> = {}) => ({
    order_code: code, client_transaction_id: crypto.randomUUID(), amount: 6000, payment_method: "Online Payment (GCash / Maya)" as const,
    reference_number: "GC 0012 3456 789", proof: { bytes: JPEG, type: "image/jpeg", size: JPEG.length }, ...o,
  });

  it("receipt files are checked by their own bytes, not only the declared type", () => {
    expect(checkProof({ bytes: JPEG, type: "image/jpeg", size: JPEG.length }).ext).toBe("jpg");
    expect(() => checkProof({ bytes: new TextEncoder().encode("<svg onload=alert(1)>"), type: "image/png", size: 20 })).toThrow(/JPG, PNG, WebP or PDF/);
    expect(() => checkProof({ bytes: JPEG, type: "image/jpeg", size: 6 * 1024 * 1024 })).toThrow(/5 MB/);
  });

  it("a submission is stored UNVERIFIED with a private proof path and opens nothing until staff verify it", async () => {
    const { store, order, acct } = await acceptedOrder();
    const files = proofs();
    expect((await err(submitCustomerPayment(store, acct.id, pay(order.order_code, { reference_number: "" }), files))).code).toBe("VALIDATION");
    expect((await err(submitCustomerPayment(store, acct.id, pay(order.order_code, { proof: null }), files))).code).toBe("VALIDATION");
    expect((await err(submitCustomerPayment(store, acct.id, pay(order.order_code, { payment_method: "Cash" }), files))).message).toMatch(/Cash is paid at the shop/);
    expect((await err(submitCustomerPayment(store, acct.id, pay(order.order_code, { amount: 999999 }), files))).message).toMatch(/remaining balance/);
    const maria = store.t.customer_accounts.find((a) => a.email === DEMO_CUSTOMER_LOGIN.email)!;
    expect((await err(submitCustomerPayment(store, maria.id, pay(order.order_code), files))).code).toBe("NOT_FOUND");

    const { payment } = await submitCustomerPayment(store, acct.id, pay(order.order_code), files);
    expect(payment).toMatchObject({ verified_by_owner_or_staff: false, payment_type: "Down Payment (30%)", reference_number: "GC 0012 3456 789", submitted_by: acct.id });
    expect(payment.proof_path).toMatch(new RegExp(`^${order.order_code}/[0-9a-f-]{36}\\.jpg$`)); // never the uploaded file name
    expect(files.files.has(payment.proof_path!)).toBe(true);
    expect((await store.getOrder(order.id))!.remaining_furniture_balance).toBe(20000);
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    expect((await customerOrderView(store, order.id)).payments[0].state).toBe("pending");

    expect((await err(verifyPayment(store, actors.craftsman, payment.id))).code).toBe("FORBIDDEN");
    await verifyPayment(store, actors.staff, payment.id);
    expect((await store.getOrder(order.id))!.remaining_furniture_balance).toBe(14000);
    expect((await startProduction(store, actors.staff, order.id)).status).toBe("In Production");
  });

  it("a rejected payment tells the customer why, never counts, and can never be verified later", async () => {
    const { store, order, acct, email } = await acceptedOrder();
    const { payment } = await submitCustomerPayment(store, acct.id, pay(order.order_code), proofs());
    expect((await err(rejectPayment(store, actors.staff, payment.id, " "))).code).toBe("VALIDATION");
    await rejectPayment(store, actors.staff, payment.id, "Reference number not found in GCash");
    expect((await err(verifyPayment(store, actors.owner, payment.id))).code).toBe("IMMUTABLE_RECORD");
    const v = await customerOrderView(store, order.id);
    expect(v.payments[0]).toMatchObject({ state: "rejected", rejection_reason: "Reference number not found in GCash" });
    expect(v.payment.furniture_paid).toBe(0);
    expect((await store.listNotifications(order.id)).some((n) => n.message_body.includes("not accepted") && (n.recipient_email ?? email) === email)).toBe(true);
  });

  it("re-submitting the same form is idempotent; at most three submissions wait at once", async () => {
    const { store, order, acct } = await acceptedOrder();
    const files = proofs();
    const once = pay(order.order_code, { amount: 1000 });
    const a = await submitCustomerPayment(store, acct.id, once, files);
    const b = await submitCustomerPayment(store, acct.id, once, files);
    expect(b.duplicate).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    await submitCustomerPayment(store, acct.id, pay(order.order_code, { amount: 1000 }), files);
    await submitCustomerPayment(store, acct.id, pay(order.order_code, { amount: 1000 }), files);
    expect((await err(submitCustomerPayment(store, acct.id, pay(order.order_code, { amount: 1000 }), files))).code).toBe("RATE_LIMITED");
  });
});
