import { describe, expect, it } from "vitest";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DEMO_CUSTOMER_LOGIN } from "@/lib/data/seed";
import { createCustomerRequest } from "@/lib/services/customer";
import { demoCompletePassword, demoCustomerAuth } from "@/lib/services/customer-auth";
import { customerOwnedAccept, customerOwnedOrder } from "@/lib/services/customer-portal";
import { confirmOrder, createOrder, reviseSpecs } from "@/lib/services/orders";
import { actors, seededStore, validOrderInput } from "./helpers";

/**
 * The Demo Inbox shows exactly what a customer would receive. These tests walk
 * the whole order flow and check every email: which ones, in what order, that
 * links point where they should, and that nothing secret leaks.
 */
const inbox = (store: MemoryStore, to: string) => [...store.t.demo_mailbox.filter((m) => m.to === to)].reverse(); // oldest first
const PASSWORD_WORDS = /\bpassword\s*[:=]\s*\S+|temporary password|your password is/i;

async function onlineOrder(email: string) {
  const store = (await seededStore()) as MemoryStore;
  const { order } = await createCustomerRequest(store, {
    customer_name: "Lorna Bacus", customer_phone: "0900 000 0712", customer_email: email,
    delivery_address: "Purok 2, Brgy. Songco, near the health center", municipality: "Lantapan",
    furniture_category: "Panel Door", design_variant: "Classic 2-Panel", width_cm: "90", height_cm: "210", depth_cm: "4.5",
    wood_type: "Mahogany", custom_wood_note: "", color_finish: "Walnut Stain", quantity: "1", special_instructions: "", reference_photo_url: "",
    client_request_key: crypto.randomUUID(), website: "",
  });
  return { store, order };
}

describe("customer emails across the order flow (Demo Inbox)", () => {
  it("submitting sends nothing; confirming sends ONE create-password email; issuing sends ONE choose-how-to-pay email", async () => {
    const email = "lorna.bacus@example.com";
    const { store, order } = await onlineOrder(email);
    expect(inbox(store, email)).toHaveLength(0); // no email before the shop has looked at it

    await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id);
    await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id).catch(() => undefined); // a double click is refused, never re-sent
    let mails = inbox(store, email);
    expect(mails.map((m) => m.subject)).toEqual([`Order ${order.order_code} confirmed — create your JJ Enterprises password`]);
    expect(mails[0].text).toMatch(/\/customer\/set-password\?token=[A-Za-z0-9_-]{40,}/);
    expect(mails[0].text).not.toMatch(PASSWORD_WORDS);
    expect(mails[0].text).toContain("JJ Enterprises will never email you a password");

    const fresh = (await store.getOrder(order.id))!;
    await reviseSpecs(store, actors.staff, order.id, { ...validOrderInput({ municipality: "Lantapan", delivery_fee: "800" }), furniture_category: "Panel Door", design_variant: "Classic 2-Panel", width_cm: "90", height_cm: "210", depth_cm: "4.5", color_finish: "Walnut Stain", furniture_price: "12500" }, fresh.current_revision);
    mails = inbox(store, email);
    expect(mails).toHaveLength(2);
    const pay = mails[1];
    expect(pay.subject).toBe(`Quotation for ${order.order_code}: choose how to pay`);
    expect(pay.text).toContain(`/customer/orders/${order.order_code}`); // login-protected page
    expect(pay.text).not.toMatch(/token=/); // no secret in this email
    expect(pay.text).toContain("30% down payment, installment or full payment");
    expect(pay.text).toMatch(/Total: ₱13,300/); // 12,500 + 800 delivery
  });

  it("re-issuing a quotation sends one new email per revision, never duplicates for the same one", async () => {
    const email = "reissue.buyer@example.com";
    const { store, order } = await onlineOrder(email);
    await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id);
    const quote = (price: string) => ({ ...validOrderInput({ municipality: "Lantapan", delivery_fee: "800" }), furniture_category: "Panel Door", design_variant: "Classic 2-Panel", width_cm: "90", height_cm: "210", depth_cm: "4.5", color_finish: "Walnut Stain", furniture_price: price });
    await reviseSpecs(store, actors.staff, order.id, quote("12000"), 1);
    await reviseSpecs(store, actors.staff, order.id, quote("12800"), 2);
    const kinds = store.t.notification_outbox.filter((r) => r.order_id === order.id).map((r) => r.kind);
    expect(kinds.filter((k) => k === "quotation_payment_request")).toHaveLength(2);
    expect(kinds.filter((k) => k === "order_confirmed_new_customer")).toHaveLength(1);
    expect(inbox(store, email).at(-1)!.text).toMatch(/Total: ₱13,600/);
  });

  it("a returning customer is told to log in; nothing asks them to create a password again", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: DEMO_CUSTOMER_LOGIN.email }));
    await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id);
    const [m] = inbox(store, DEMO_CUSTOMER_LOGIN.email);
    expect(m.subject).toBe(`Order ${order.order_code} is confirmed`);
    expect(m.text).toMatch(/\/login\b/);
    expect(m.text).not.toMatch(/set-password/);
  });

  it("walk-in orders never produce an email", async () => {
    const store = (await seededStore()) as MemoryStore;
    const before = store.t.demo_mailbox.length;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: "", has_no_email: "on" }));
    await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id);
    expect(store.t.demo_mailbox.length).toBe(before);
  });

  it("the full journey: password link works once, the customer accepts and the email trail stays clean", async () => {
    const email = "journey.buyer@example.com";
    const { store, order } = await onlineOrder(email);
    await confirmOrder(store, actors.staff, demoCustomerAuth(store), order.id);
    await reviseSpecs(store, actors.staff, order.id, { ...validOrderInput({ municipality: "Lantapan", delivery_fee: "800" }), furniture_category: "Panel Door", design_variant: "Classic 2-Panel", width_cm: "90", height_cm: "210", depth_cm: "4.5", color_finish: "Walnut Stain", furniture_price: "12500" }, 1);
    const token = inbox(store, email)[0].text.match(/set-password\?token=([A-Za-z0-9_-]+)/)![1];
    await demoCompletePassword(store, token, "Pinto-Mahogany-90");
    await expect(demoCompletePassword(store, token, "Another-Pass-99")).rejects.toThrow(/invalid or has expired/);
    const acct = store.t.customer_accounts.find((a) => a.email === email)!;
    const { view } = await customerOwnedOrder(store, acct.id, order.order_code);
    await customerOwnedAccept(store, acct.id, order.order_code, {
      expected_revision_number: view.current!.revision_number, accepted_furniture_price: 12500, accepted_delivery_fee: 800,
      client_idempotency_key: crypto.randomUUID(), accept_specification: true, accept_quotation: true, payment_plan: "full", payment_method: "Bank Transfer",
    });
    // the email log on the order never stores a link or a token
    const logs = (await store.listNotifications(order.id)).filter((n) => n.channel === "Email");
    expect(logs.length).toBeGreaterThan(0);
    for (const n of logs) expect(n.message_body).not.toMatch(/token=|https?:\/\//);
    expect(JSON.stringify(store.t.notification_outbox.filter((r) => r.order_id === order.id))).not.toContain(token);
  });
});
