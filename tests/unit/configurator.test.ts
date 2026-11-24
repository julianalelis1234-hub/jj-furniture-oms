import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain/errors";
import { describeDiff, diffSpecs, formatDims } from "@/lib/domain/furniture";
import { customerOrderView, customerProposeChanges, customerRequestRepair } from "@/lib/services/customer";
import { decideException, requestException, reviewCustomerProposal } from "@/lib/services/exceptions";
import { createOrder, recordConfirmation, startProduction, transitionOrder } from "@/lib/services/orders";
import { actors, customerAccept, issueQuotation, payDown, readyForAcceptance, seededStore, shopConfirm, staffAccept, validOrderInput } from "./helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("expected an error");
};

const proposal = {
  furniture_category: "Dining Table",
  design_variant: "8-Seater Banquet",
  width_cm: "220",
  height_cm: "76",
  depth_cm: "100",
  wood_type: "Mahogany",
  custom_wood_note: "",
  color_finish: "Dark Espresso",
  quantity: "1",
};

async function newOrder() {
  const store = await seededStore();
  const { order } = await createOrder(store, actors.staff, validOrderInput({ wood_type: "Gmelina", furniture_price: "24000" }));
  return { store, order };
}

describe("specification revisions & customer scenarios", () => {
  it("diff helpers describe exact field changes", () => {
    const d = diffSpecs({ wood_type: "Gmelina", width_cm: 180 }, { wood_type: "Mahogany", width_cm: 220 });
    expect(describeDiff(d)).toBe("Wood: Gmelina -> Mahogany; Width: 180cm -> 220cm");
    expect(formatDims({ width_cm: null, height_cm: 1, depth_cm: 1 })).toBeNull();
  });

  it("Scenario 1: submit -> shop confirms -> quotation issued -> customer accepts the latest revision", async () => {
    const { store, order } = await newOrder();
    expect((await customerOrderView(store, order.id)).spec_state).toBe("submitted");
    await shopConfirm(store, order.id);
    expect((await customerOrderView(store, order.id)).spec_state).toBe("awaiting_quotation");
    await issueQuotation(store, order.id);
    const view = await customerOrderView(store, order.id);
    expect(view.spec_state).toBe("awaiting_acceptance");
    expect(view.current?.revision_number).toBe(2);
    const o = await customerAccept(store, order.id, 2);
    expect(o.status).toBe("Confirmed"); // acceptance does not move the status (migration 009)
    expect(o.approved_revision_number).toBe(2);
    expect((await customerOrderView(store, order.id)).spec_state).toBe("accepted");
    const [c] = await store.listConfirmations(order.id);
    expect(c.revision_id).toBe((await store.listRevisions(order.id))[1].revision_id);
    expect(c.specification_accepted_at).toBeTruthy();
    expect(c.quotation_accepted_at).toBe(c.specification_accepted_at);
    expect(c.accepted_total_amount).toBe(24000);
  });

  it("Scenario 2: a proposal is a new immutable revision, raises a review, and locks nothing open", async () => {
    const { store, order } = await newOrder();
    await readyForAcceptance(store, order.id); // confirmed, quotation = revision 2
    const res = await customerProposeChanges(store, order.id, 2, proposal);
    expect(res.revision_number).toBe(3);
    const o = (await store.getOrder(order.id))!;
    expect(o.current_revision).toBe(3);
    expect(o.wood_type).toBe("Gmelina"); // authoritative spec unchanged
    expect(o.specs_confirmed).toBe(false);
    expect(o.approved_revision_number).toBeNull();
    const ex = (await store.listExceptions(order.id)).find((e) => e.category === "Spec Clarification")!;
    expect(ex.status).toBe("Pending");
    expect(ex.description).toContain("Wood: Gmelina -> Mahogany");
    expect(ex.description).toContain("Width: 120cm -> 220cm");
    expect((await store.listNotifications(order.id)).some((n) => n.channel === "In-App")).toBe(true);
    const view = await customerOrderView(store, order.id);
    expect(view.spec_state).toBe("proposal_under_review");
    // the customer cannot accept their own proposal, nor the stale revision 2
    expect((await err(customerAccept(store, order.id, 3))).code).toBe("PENDING_REVIEW");
    expect((await err(customerAccept(store, order.id, 2))).code).toBe("STALE_REVISION");
    // production stays locked
    expect((await err(transitionOrder(store, actors.owner, order.id, "In Production"))).code).toBe("SPECS_NOT_CONFIRMED");
  });

  it("staff quote the proposal (price impact) -> customer must accept the revised quote", async () => {
    const { store, order } = await newOrder();
    await readyForAcceptance(store, order.id);
    await customerProposeChanges(store, order.id, 2, proposal);
    const ex = (await store.listExceptions(order.id)).find((e) => e.category === "Spec Clarification")!;
    // the generic "answer" path is refused for proposals
    expect((await err(decideException(store, actors.staff, ex.id, "Resolved", "ok"))).code).toBe("VALIDATION");
    const quoted = await reviewCustomerProposal(store, actors.staff, ex.id, "quote", { ...proposal, furniture_price: "31000", delivery_fee: "0" }, "Bigger table");
    expect(quoted.current_revision).toBe(4);
    expect(quoted.furniture_price).toBe(31000);
    expect(quoted.wood_type).toBe("Mahogany");
    expect(quoted.status).toBe("Confirmed"); // re-issued quotation; the order stays confirmed
    expect((await store.listExceptions(order.id)).find((e) => e.id === ex.id)!.status).toBe("Resolved");
    const confirmed = await customerAccept(store, order.id, 4);
    expect(confirmed.approved_revision_number).toBe(4);
    const revs = await store.listRevisions(order.id);
    expect(revs.map((r) => r.revision_type)).toEqual(["staff_draft", "revised_quote", "customer_proposal", "revised_quote"]);
  });

  it("staff may keep the original spec; the new quote revision equals the previous quote", async () => {
    const { store, order } = await newOrder();
    await customerProposeChanges(store, order.id, 1, proposal);
    const ex = (await store.listExceptions(order.id)).find((e) => e.category === "Spec Clarification")!;
    const kept = await reviewCustomerProposal(store, actors.owner, ex.id, "decline", {}, "Banquet size will not fit the room");
    expect(kept.current_revision).toBe(3);
    expect(kept.wood_type).toBe("Gmelina");
    expect(kept.width_cm).toBe(120);
  });

  it("Scenario 3: every gate is required for production (30% verified, no blocking items, latest revision)", async () => {
    const { store, order } = await newOrder();
    await staffAccept(store, actors.staff, order.id);
    // craftsmen can no longer start production themselves
    expect((await err(transitionOrder(store, actors.craftsman, order.id, "In Production"))).code).toBe("FORBIDDEN");
    // Confirmed is not authorization to cut wood
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    await payDown(store, order.id, 7199.99);
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("DOWN_PAYMENT_REQUIRED");
    await payDown(store, order.id, 0.01);
    // open production-blocking item blocks In Production
    await requestException(store, actors.craftsman, { order_id: order.id, category: "Spec Clarification", description: "Edge profile?" });
    expect((await err(startProduction(store, actors.staff, order.id))).code).toBe("PENDING_REVIEW");
    const q = (await store.listExceptions(order.id)).find((e) => e.description === "Edge profile?")!;
    expect(q.is_production_blocking).toBe(true);
    await decideException(store, actors.staff, q.id, "Resolved", "Rounded");
    const started = await startProduction(store, actors.staff, order.id);
    expect(started.status).toBe("In Production");
    // once in production, specs and quote are locked
    expect((await err(store.updateOrder(order.id, { furniture_price: 1 }))).code).toBe("SPEC_LOCKED");
    expect((await err(customerProposeChanges(store, order.id, (await store.getOrder(order.id))!.current_revision, proposal))).code).toBe("SPEC_LOCKED");
    expect((await customerOrderView(store, order.id)).spec_state).toBe("locked");
    // later changes go through a change request
    const cr = await customerRequestRepair(store, order.id, "Please add a drawer", "change");
    expect(cr.description).toMatch(/^Post-confirmation change request/);
  });

  it("staff cannot record a 'Customer Portal PIN' confirmation; craftsmen cannot confirm at all", async () => {
    const { store, order } = await newOrder();
    const input = {
      order_id: order.id, confirmation_method: "Customer Portal PIN" as const, confirmed_by_name: "x", revision_number: 1,
      accepted_furniture_price: 24000, accepted_delivery_fee: 0, client_idempotency_key: "k-1",
    };
    expect((await err(recordConfirmation(store, actors.staff, input))).code).toBe("FORBIDDEN");
    expect((await err(recordConfirmation(store, actors.craftsman, { ...input, confirmation_method: "Signed Paper Slip" }))).code).toBe("FORBIDDEN");
  });

  it("legacy orders show 'pending clarification' and must be re-quoted before confirmation", async () => {
    const store = await seededStore();
    const legacy = (await store.getOrderByCode("JJ-2026-0133"))!;
    expect(legacy.is_legacy_incomplete).toBe(true);
    expect(legacy.width_cm).toBeNull();
    const view = await customerOrderView(store, legacy.id);
    expect(view.current?.legacy_dimensions_text).toBe("180cm x 120cm x 60cm");
    expect(view.spec_state).toBe("locked"); // delivered
  });

  it("workshop data carries structured dimensions but no money", async () => {
    const store = await seededStore();
    const w = (await store.listWorkshopOrders()).find((x) => x.order_code === "JJ-2026-0145")!;
    expect(w.width_cm).toBe(210);
    expect(w.furniture_category).toBe("Dining Table");
    expect(Object.keys(w).join(",")).not.toMatch(/price|fee|collectible|phone|address/);
  });
});
