import { describe, expect, it } from "vitest";
import type { MemoryStore } from "@/lib/data/memory-store";
import { withActorRole } from "@/lib/realtime/actor-context";
import { backoffDelay, dedupKey, isLivePing, LiveState, MAX_QUEUE, toastFor } from "@/lib/realtime/core";
import { classifyOrderChange, visibleTo, type LiveEvent } from "@/lib/realtime/events";
import { createCustomerRequest } from "@/lib/services/customer";
import { liveFeedFor } from "@/lib/services/live";
import { createOrder, editOrderDetails, startProduction } from "@/lib/services/orders";
import { actors, customerAccept, payDown, seededStore, staffAccept, validOrderInput } from "./helpers";

let n = 0;
const ev = (p: Partial<LiveEvent>): LiveEvent => ({
  id: ++n, source: "orders", op: "UPDATE", record_id: "o1", order_id: "o1", order_code: "JJ-2026-0001", status: "Confirmed",
  prev_status: "Waiting for Confirmation", transition: null, payment_verified: null, actor_role: "system",
  order_updated_at: new Date(1_700_000_000_000 + n * 1000).toISOString(), occurred_at: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...p,
});
const since = (store: MemoryStore, from: number) => store.t.live_events.filter((e) => e.id > from);

describe("live feed: the demo store emits exactly what the SQL triggers emit", () => {
  it("new quote request -> quote_requested; note edit -> change signal WITHOUT a transition", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { order } = await createCustomerRequest(store, {
      client_request_key: crypto.randomUUID(), customer_name: "Rt Buyer", customer_email: "rt.buyer@example.com", customer_phone: "09000000777",
      municipality: "Lantapan", delivery_address: "Purok 7, Songco", furniture_category: "Panel Door", design_variant: "Classic 2-Panel",
      width_cm: "80", height_cm: "210", depth_cm: "4.5", wood_type: "Gmelina", color_finish: "Natural Varnish", quantity: "1",
    });
    const ins = store.t.live_events.find((e) => e.order_id === order.id && e.op === "INSERT")!;
    expect(ins.transition).toBe("quote_requested");
    const mark = store.t.live_events.at(-1)!.id;
    const o = (await store.getOrderByCode("JJ-2026-0145"))!;
    await withActorRole("staff", () => editOrderDetails(store, actors.staff, o.id, {
      customer_email: o.customer_email ?? "", has_no_email: o.has_no_email ? "on" : "", customer_phone: o.customer_phone,
      delivery_address: o.delivery_address + " (blue gate)", municipality: o.municipality, delivery_fee: o.delivery_fee,
      estimated_completion_date: o.estimated_completion_date ?? "", scheduled_delivery_date: o.scheduled_delivery_date ?? "",
    }));
    const edits = since(store, mark);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every((e) => e.transition === null)).toBe(true);
    expect(edits.every((e) => toastFor(e, "owner") === null && toastFor(e, "customer") === null)).toBe(true); // never "quotation confirmed"
  });

  it("acceptance -> quote_accepted (with the committed confirmation); production -> stage_progress", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: "rt.accept@example.com", furniture_price: "20000" }));
    const mark = store.t.live_events.at(-1)!.id;
    await customerAccept(store, order.id);
    const acc = since(store, mark);
    expect(acc.map((e) => e.source)).toEqual(["order_confirmations", "orders"]);
    expect(acc[1]).toMatchObject({ transition: "quote_accepted", prev_status: "Waiting for Confirmation", status: "Confirmed" });
    const m2 = store.t.live_events.at(-1)!.id;
    await payDown(store, order.id);
    await withActorRole("owner", () => startProduction(store, actors.owner, order.id));
    const prog = since(store, m2).filter((e) => e.transition === "stage_progress");
    expect(prog).toHaveLength(1);
    expect(prog[0]).toMatchObject({ prev_status: "Confirmed", status: "In Production", actor_role: "owner" });
  });

  it("an UNVERIFIED driver collection is never a verified payment; the staff verification is", async () => {
    const store = (await seededStore()) as MemoryStore;
    const o = (await store.getOrderByCode("JJ-2026-0145"))!;
    const mark = store.t.live_events.at(-1)?.id ?? 0;
    const { payment } = await store.insertPayment({
      order_id: o.id, client_transaction_id: crypto.randomUUID(), payment_type: "Delivery Balance Collection", amount: 1000, payment_method: "Cash",
      collected_by_id: actors.driver.id, verified_by_owner_or_staff: false, notes: null, paid_at: new Date().toISOString(),
    });
    const unverified = since(store, mark).filter((e) => e.source === "payments");
    expect(unverified).toEqual([expect.objectContaining({ payment_verified: false, transition: null })]);
    const maria = store.t.customer_accounts[0];
    const asCustomer = await liveFeedFor(store, { role: "customer", id: maria.id }, mark);
    expect(asCustomer.events.some((e) => e.source === "payments")).toBe(false);
    expect(asCustomer.events.some((e) => e.transition === "payment_verified")).toBe(false);
    await withActorRole("staff", () => store.updatePayment(payment.id, { verified_by_owner_or_staff: true }));
    const after = await liveFeedFor(store, { role: "customer", id: maria.id }, mark);
    const verified = after.events.filter((e) => e.transition === "payment_verified");
    expect(verified).toHaveLength(1);
    expect(toastFor(verified[0], "customer")?.title).toBe("Payment verified");
  });
});

describe("live feed visibility per role (mirrors the RLS policies)", () => {
  it("customers: own orders only; craftsmen: workshop orders, no money/quotes; drivers: assigned deliveries only", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: "rt.scope@example.com", furniture_price: "20000" }));
    await staffAccept(store, actors.staff, order.id);
    await payDown(store, order.id);
    await startProduction(store, actors.owner, order.id);
    const maria = store.t.customer_accounts[0];
    const all = await liveFeedFor(store, { role: "owner", id: actors.owner.id }, 0);
    expect(all.events.length).toBe(store.t.live_events.length);
    expect((await liveFeedFor(store, { role: "customer", id: maria.id }, 0)).events.some((e) => e.order_id === order.id)).toBe(false);
    const craft = (await liveFeedFor(store, { role: "craftsman", id: actors.craftsman.id }, 0)).events;
    expect(craft.length).toBeGreaterThan(0);
    expect(craft.every((e) => e.source === "orders" && e.transition !== "quote_accepted" && e.transition !== "payment_verified")).toBe(true);
    const drv = (await liveFeedFor(store, { role: "driver", id: actors.driver.id }, 0)).events;
    expect(drv.some((e) => e.order_id === order.id)).toBe(false); // not assigned to this driver
    expect(drv.every((e) => e.source !== "payments")).toBe(true);
  });
  it("classification never makes Quote Requested an 8th stage", () => {
    expect(classifyOrderChange("UPDATE", "Quote Requested", "Waiting for Confirmation", false)).toBeNull();
    expect(classifyOrderChange("UPDATE", "Waiting for Confirmation", "Confirmed", false)).toBe("stage_progress");
    expect(classifyOrderChange("UPDATE", "Waiting for Confirmation", "Confirmed", true)).toBe("quote_accepted");
    expect(visibleTo(ev({ source: "payments", payment_verified: false }), { role: "customer", id: "c" }, { owned: new Set(["o1"]) })).toBe(false);
  });
});

describe("client live state: dedup, ordering, verified notifications", () => {
  it("duplicate deliveries and overlap re-reads never toast twice", () => {
    const s = new LiveState("owner", 0);
    const e = ev({ transition: "quote_accepted" });
    expect(s.ingest([e]).toasts).toHaveLength(1);
    const again = s.ingest([e, { ...e }]);
    expect(again.changed).toHaveLength(0);
    expect(again.toasts).toHaveLength(0);
    expect(dedupKey(e)).toContain("orders:o1:UPDATE");
  });
  it("an older, out-of-order event never overwrites newer state (it asks for an authoritative re-read)", () => {
    const s = new LiveState("owner", 0);
    const newer = ev({ status: "In Production", prev_status: "Confirmed", transition: "stage_progress" });
    const older = { ...ev({ status: "Confirmed", transition: "quote_accepted" }), id: newer.id - 1, order_updated_at: new Date(Date.parse(newer.order_updated_at!) - 5000).toISOString() };
    expect(s.ingest([newer]).changed).toHaveLength(1);
    const r = s.ingest([older]);
    expect(r.changed).toHaveLength(0);
    expect(r.toasts).toHaveLength(0);
    expect(r.stale).toBe(true);
  });
  it("events already reflected in the rendered page (reconnect reconciliation) are silent", () => {
    const e = ev({ transition: "stage_progress", status: "In Production", prev_status: "Confirmed" });
    const s = new LiveState("customer", e.id); // page was rendered after this event
    const r = s.ingest([e]);
    expect(r.changed).toHaveLength(0);
    expect(r.toasts).toHaveLength(0);
  });
  it("after a gap only the newest state per order is announced", () => {
    const s = new LiveState("customer", 0);
    const r = s.ingest([
      ev({ transition: "stage_progress", prev_status: "Confirmed", status: "In Production" }),
      ev({ transition: "stage_progress", prev_status: "In Production", status: "Completed / For Inspection" }),
    ]);
    expect(r.changed).toHaveLength(2);
    expect(r.toasts).toHaveLength(1);
    expect(r.toasts[0].description).toContain("Completed / For Inspection");
  });
  it("notification rules: only verified transitions, never for the role that acted, never for craftsmen/drivers", () => {
    expect(toastFor(ev({ transition: null }), "owner")).toBeNull();
    expect(toastFor(ev({ transition: "quote_accepted", actor_role: "staff" }), "staff")).toBeNull();
    expect(toastFor(ev({ transition: "quote_accepted", actor_role: "system" }), "staff")?.title).toBe("Quotation accepted");
    expect(toastFor(ev({ op: "INSERT", status: "Quote Requested", prev_status: null, transition: "quote_requested" }), "owner")?.title).toBe("New quote request");
    expect(toastFor(ev({ op: "INSERT", status: "Quote Requested", prev_status: null, transition: "quote_requested" }), "customer")).toBeNull();
    expect(toastFor(ev({ source: "payments", payment_verified: false, transition: null }), "customer")).toBeNull();
    expect(toastFor(ev({ transition: "stage_progress", status: "In Production" }), "craftsman")).toBeNull();
    expect(toastFor(ev({ transition: "stage_progress", status: "Out for Delivery" }), "driver")).toBeNull();
  });
  it("reconnect backoff grows exponentially and is capped; queue bound exists", () => {
    const d = [0, 1, 2, 3, 10].map((a) => backoffDelay(a, () => 1));
    expect(d).toEqual([1000, 2000, 4000, 8000, 30000]);
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(MAX_QUEUE).toBeGreaterThan(0);
  });
  it("demo cross-tab messages: bare pings only; anything else is rejected", () => {
    expect(isLivePing({ type: "jj-live-ping", v: 1, cursor: 4 })).toBe(true);
    for (const bad of [null, "x", { type: "jj-live-ping", v: 1, cursor: -1 }, { type: "jj-live-ping", v: 1, cursor: 4, token: "abc" }, { type: "other", v: 1, cursor: 1 }])
      expect(isLivePing(bad)).toBe(false);
  });
});
