import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain/errors";
import { computeFinancials, previewNewOrder, splitDeliveryCollection } from "@/lib/domain/finance";
import { isValidTransition } from "@/lib/domain/status";
import { ORDER_STATUSES, WORKSHOP_STAGES, type OrderStatus, type Payment } from "@/lib/domain/types";
import { newOrderSchema } from "@/lib/domain/validation";
import { logPayment } from "@/lib/services/payments";
import {
  createOrder,
  failInspection,
  moveInQueue,
  passInspection,
  productionQueue,
  setPaymentTerms,
  setPriorityLabel,
  startProduction,
  transitionOrder,
} from "@/lib/services/orders";
import { decideException, requestException } from "@/lib/services/exceptions";
import { scheduleDelivery } from "@/lib/services/deliveries";
import { actors, payDown, seededStore, staffAccept, validOrderInput } from "./helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("expected an error");
};

describe("1. form & input validation", () => {
  it("rejects a missing paper slip number", () => {
    const r = newOrderSchema.safeParse(validOrderInput({ paper_slip_number: "  " }));
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["paper_slip_number"]);
  });
  it("rejects missing or out-of-range dimensions", () => {
    const r = newOrderSchema.safeParse(validOrderInput({ width_cm: "" }));
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toContain("width_cm");
    expect(newOrderSchema.safeParse(validOrderInput({ height_cm: "0" })).success).toBe(false);
    expect(newOrderSchema.safeParse(validOrderInput({ depth_cm: "1200" })).success).toBe(false);
  });
  it('requires a custom wood note when wood is "Other" and a design that fits the category', () => {
    const r = newOrderSchema.safeParse(validOrderInput({ wood_type: "Other", custom_wood_note: " " }));
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toContain("custom_wood_note");
    expect(newOrderSchema.safeParse(validOrderInput({ wood_type: "Other", custom_wood_note: "Narra" })).success).toBe(true);
    expect(newOrderSchema.safeParse(validOrderInput({ design_variant: "Classic 2-Panel" })).success).toBe(false);
    expect(newOrderSchema.safeParse(validOrderInput({ color_finish: "Navy Blue" })).success).toBe(false);
  });
  it("rejects negative or zero prices", () => {
    expect(newOrderSchema.safeParse(validOrderInput({ furniture_price: "-500" })).success).toBe(false);
    expect(newOrderSchema.safeParse(validOrderInput({ furniture_price: "0" })).success).toBe(false);
  });
  it("requires a delivery fee outside Valencia City", () => {
    const r = newOrderSchema.safeParse(validOrderInput({ municipality: "Lantapan", delivery_fee: "0" }));
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["delivery_fee"]);
  });
  it("normalises PH mobile numbers and rejects bad ones", () => {
    expect(newOrderSchema.parse(validOrderInput()).customer_phone).toBe("09000000201");
    expect(newOrderSchema.safeParse(validOrderInput({ customer_phone: "12345" })).success).toBe(false);
  });
  it("rejects duplicate paper slip numbers on create", async () => {
    const store = await seededStore();
    const e = await err(createOrder(store, actors.staff, validOrderInput({ paper_slip_number: "0145" })));
    expect(e.code).toBe("DUPLICATE_SLIP");
  });
  it("creates a draft order with a DR code, normalized unverified email (no PIN) and history", async () => {
    const store = await seededStore();
    const { order } = await createOrder(store, actors.staff, validOrderInput());
    expect(order.order_code).toMatch(/^DR-\d{4}$/);
    expect(order.current_revision).toBe(1);
    expect(order.dimensions).toBe("120.0 × 76.0 × 80.0 cm (W × H × D)");
    expect(order.item_name).toBe("4-Seater Rectangular Dining Table");
    expect(order.pin_code_hash).toBeNull();
    expect(order.customer_email).toBe("juan.delacruz@example.com");
    expect(order.email_verified_at).toBeNull();
    expect(order.status).toBe("Waiting for Confirmation");
    expect((await store.listHistory(order.id))[0].notes).toContain("paper slip");
  });
  it("blocks craftsmen and drivers from encoding orders", async () => {
    const store = await seededStore();
    expect((await err(createOrder(store, actors.craftsman, validOrderInput()))).code).toBe("FORBIDDEN");
    expect((await err(createOrder(store, actors.driver, validOrderInput()))).code).toBe("FORBIDDEN");
  });
});

describe("2. the 7-stage status machine", () => {
  it("allows exactly the documented transitions", () => {
    const allowed: [OrderStatus, OrderStatus][] = [
      ["Waiting for Confirmation", "Confirmed"],
      ["Confirmed", "In Production"],
      ["In Production", "Completed / For Inspection"],
      ["Completed / For Inspection", "Ready for Delivery"],
      ["Ready for Delivery", "Out for Delivery"],
      ["Out for Delivery", "Delivered"],
    ];
    for (const [a, b] of allowed) expect(isValidTransition(a, b)).toBe(true);
    expect(isValidTransition("Waiting for Confirmation", "In Production")).toBe(false);
    expect(isValidTransition("Confirmed", "Delivered")).toBe(false);
    for (const s of ORDER_STATUSES) if (s !== "Delivered") expect(isValidTransition("Delivered", s)).toBe(false);
  });

  it("walks a new order through all 7 stages with the right roles", async () => {
    const store = await seededStore();
    const { order } = await createOrder(store, actors.staff, validOrderInput());
    let o = await staffAccept(store, actors.staff, order.id);
    expect(o.approved_revision_number).toBe(1);
    expect(o.status).toBe("Confirmed");
    expect(o.order_code).toMatch(/^JJ-\d{4}-\d{4}$/);
    expect((await err(transitionOrder(store, actors.craftsman, o.id, "In Production"))).code).toBe("FORBIDDEN");
    expect((await err(startProduction(store, actors.staff, o.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    await logPayment(store, actors.staff, {
      order_id: o.id, client_transaction_id: crypto.randomUUID(), payment_type: "Down Payment (30%)", amount: 3000, payment_method: "Cash",
    });
    o = await startProduction(store, actors.staff, o.id, actors.craftsman.id);
    expect(o.status).toBe("In Production");
    expect(o.assigned_craftsman_id).toBe(actors.craftsman.id);
    o = await transitionOrder(store, actors.craftsman, o.id, "Completed / For Inspection");
    expect((await err(transitionOrder(store, actors.staff, o.id, "Ready for Delivery"))).code).toBe("OWNER_ONLY");
    expect((await err(transitionOrder(store, actors.craftsman, o.id, "Ready for Delivery"))).code).toBe("OWNER_ONLY");
    o = await passInspection(store, actors.owner, o.id);
    expect(o.status).toBe("Ready for Delivery");
    o = await transitionOrder(store, actors.staff, o.id, "Out for Delivery");
    o = await transitionOrder(store, actors.staff, o.id, "Delivered");
    expect(o.status).toBe("Delivered");
    const history = await store.listHistory(o.id);
    expect(new Set(history.map((h) => h.to_status))).toEqual(new Set(WORKSHOP_STAGES));
  });

  it("blocks In Production while specs_confirmed is false (hard gate)", async () => {
    const store = await seededStore();
    const { order } = await createOrder(store, actors.staff, validOrderInput());
    const e = await err(transitionOrder(store, actors.owner, order.id, "Confirmed"));
    expect(e.code).toBe("SPECS_NOT_CONFIRMED");
    // even forcing the row at store level is rejected, like the DB trigger
    const e2 = await err(store.updateOrder(order.id, { status: "Confirmed" }));
    expect(e2.code).toBe("SPECS_NOT_CONFIRMED");
    const e3 = await err(store.updateOrder(order.id, { status: "In Production" }));
    expect(e3.code).toBe("INVALID_TRANSITION");
    const e4 = await err(store.updateOrder(order.id, { specs_confirmed: true, status: "Confirmed" }));
    expect(e4.code).toBe("STALE_REVISION"); // flipping the flag alone never unlocks production
  });

  it("failed inspection sends the job back as For Revision", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0139"))!;
    expect((await err(failInspection(store, actors.owner, o.id, "  "))).code).toBe("VALIDATION");
    await failInspection(store, actors.owner, o.id, "Drawer rails sticking");
    const w = (await store.listWorkshopOrders()).find((x) => x.id === o.id)!;
    expect(w.status).toBe("In Production");
    expect(w.needs_revision).toBe(true);
  });

  it("optimistic version conflicts are detected", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0141"))!;
    const e = await err(transitionOrder(store, actors.owner, o.id, "In Production", { expectedVersion: o.version - 1 }));
    expect(e.code).toBe("VERSION_CONFLICT");
  });
});

describe("4. financial & delivery-fee accuracy", () => {
  it("30% down / 70% balance, Valencia City free delivery", () => {
    const p = previewNewOrder(28500, "Valencia City", 900);
    expect(p.standard_down_payment_due).toBe(8550);
    expect(p.balance_after_down_payment).toBe(19950);
    expect(p.delivery_fee).toBe(0);
    expect(p.collectible_after_down_payment).toBe(19950);
  });
  it("provincial delivery fee is added to the collectible", () => {
    const p = previewNewOrder(45000, "Cabanglasan", 1500);
    expect(p.delivery_fee).toBe(1500);
    expect(p.collectible_after_down_payment).toBe(33000);
  });
  it("only verified payments reduce balances; fee payments clear the fee", () => {
    const pay = (amount: number, type: Payment["payment_type"], verified = true) =>
      ({ order_id: "x", amount, payment_type: type, verified_by_owner_or_staff: verified }) as Payment;
    const base = { furniture_price: 10000, delivery_fee: 800, municipality: "Lantapan" as const };
    expect(computeFinancials(base, [pay(3000, "Down Payment (30%)")]).collectible_on_delivery).toBe(7800);
    expect(computeFinancials(base, [pay(3000, "Down Payment (30%)"), pay(7000, "Delivery Balance Collection", false)]).remaining_furniture_balance).toBe(7000);
    const all = computeFinancials(base, [pay(3000, "Down Payment (30%)"), pay(7000, "Delivery Balance Collection"), pay(800, "Delivery Fee")]);
    expect(all.remaining_furniture_balance).toBe(0);
    expect(all.collectible_on_delivery).toBe(0);
  });
  it("splits delivery cash between balance and fee", () => {
    expect(splitDeliveryCollection({ remaining_furniture_balance: 31500 }, 33000)).toEqual({ toBalance: 31500, toFee: 1500 });
  });
  it("seeded orders carry exact computed amounts", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0136"))!;
    expect(o.standard_down_payment_due).toBe(13500);
    expect(o.remaining_furniture_balance).toBe(31500);
    expect(o.collectible_on_delivery).toBe(33000);
    const v = (await store.getOrderByCode("JJ-2026-0145"))!;
    expect(v.delivery_fee).toBe(0);
    expect(v.collectible_on_delivery).toBe(19950);
  });
  it("logging more than is owed is rejected", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0145"))!;
    const e = await err(logPayment(store, actors.staff, {
      order_id: o.id, client_transaction_id: crypto.randomUUID(), payment_type: "Installment / Partial", amount: 999999, payment_method: "Cash",
    }));
    expect(e.code).toBe("VALIDATION");
  });
});

describe("owner approvals, priority and the exception gate", () => {
  it("installment terms create a pending owner approval; staff cannot approve", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0145"))!;
    await setPaymentTerms(store, actors.staff, o.id, "Installment");
    const ex = (await store.listExceptions(o.id)).find((e) => e.category === "Installment Approval")!;
    expect(ex.status).toBe("Pending");
    expect((await err(decideException(store, actors.staff, ex.id, "Approved"))).code).toBe("OWNER_ONLY");
    await decideException(store, actors.owner, ex.id, "Approved");
    expect((await store.getOrder(o.id))!.payment_exception_approved).toBe(true);
  });
  it("an installment order still needs the verified 30% (or the owner's approval) before production", async () => {
    const store = await seededStore();
    const { order } = await createOrder(store, actors.staff, validOrderInput({ payment_exception_type: "Installment" }));
    const approval = (await store.listExceptions(order.id)).find((e) => e.category === "Installment Approval")!;
    expect(approval.is_production_blocking).toBe(false); // the payment gate covers it
    await staffAccept(store, actors.staff, order.id);
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    await decideException(store, actors.owner, approval.id, "Approved");
    const started = await startProduction(store, actors.owner, order.id);
    expect(started.status).toBe("In Production"); // audited owner exception instead of 30%
  });
  it("scheduling a seeded installment order keeps one pending approval (no duplicates)", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0140"))!;
    const before = (await store.listExceptions(o.id)).filter((e) => e.status === "Pending").length;
    await scheduleDelivery(store, actors.staff, {
      order_id: o.id, driver_id: actors.driver.id, vehicle_type: "Multicab", scheduled_date: "2026-12-01", time_window: "9:00 AM - 11:00 AM",
    });
    expect((await store.listExceptions(o.id)).filter((e) => e.status === "Pending").length).toBe(before);
  });
  it("spec questions are answered into the order instructions", async () => {
    const store = await seededStore();
    const o = (await store.getOrderByCode("JJ-2026-0145"))!;
    const q = await requestException(store, actors.craftsman, { order_id: o.id, category: "Spec Clarification", description: "Gloss or satin?" });
    expect((await err(requestException(store, actors.craftsman, { order_id: o.id, category: "Installment Approval", description: "x" }))).code).toBe("FORBIDDEN");
    await decideException(store, actors.staff, q.id, "Resolved", "Gloss, same as sample");
    expect((await store.getOrder(o.id))!.special_instructions).toContain("Gloss, same as sample");
  });
  it("only the owner reorders the production queue", async () => {
    const store = await seededStore();
    const queue = productionQueue(await store.listOrders());
    expect((await err(moveInQueue(store, actors.staff, queue[1].id, "up"))).code).toBe("FORBIDDEN");
    const after = await moveInQueue(store, actors.owner, queue[1].id, "up");
    expect(after[0].id).toBe(queue[1].id);
    expect(after.map((o) => o.priority_rank)).toEqual(after.map((_, i) => i + 1));
    const urgent = await setPriorityLabel(store, actors.owner, queue[queue.length - 1].id, "Urgent");
    expect(urgent.priority_rank).toBe(1);
  });
});
