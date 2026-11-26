import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain/errors";
import { approveInstallmentPlan, decideException } from "@/lib/services/exceptions";
import { createOrder, startProduction } from "@/lib/services/orders";
import { actors, payDown, seededStore, staffAccept, validOrderInput } from "./helpers";

const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DomainError; } throw new Error("expected an error"); };

async function accepted(plan: "down_30" | "full" | "installment") {
  const store = await seededStore();
  const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: `${plan}.terms@example.com`, furniture_price: "12000" }));
  await staffAccept(store, actors.staff, order.id);
  if (plan !== "down_30") await store.updateOrder(order.id, { payment_plan: plan });
  return { store, id: order.id };
}

describe("the workshop starts by the customer's payment terms", () => {
  it("30% down payment: the verified 30% is enough", async () => {
    const { store, id } = await accepted("down_30");
    expect((await err(startProduction(store, actors.staff, id))).message).toMatch(/30% down payment/);
    await payDown(store, id, 3600);
    expect((await startProduction(store, actors.staff, id)).status).toBe("In Production");
  });

  it("full payment: 30% is not enough, the whole price is", async () => {
    const { store, id } = await accepted("full");
    await payDown(store, id, 3600);
    expect((await err(startProduction(store, actors.staff, id))).message).toMatch(/full payment \(₱12,000\)/);
    await payDown(store, id, 8400);
    expect((await startProduction(store, actors.staff, id)).status).toBe("In Production");
  });

  it("installment: no down payment, only the owner's approval", async () => {
    const { store, id } = await accepted("installment");
    expect((await err(startProduction(store, actors.staff, id))).message).toMatch(/owner must approve the installment plan/);
    const ex = await store.insertException({
      order_id: id, category: "Installment Approval", description: "Installment requested", requested_by: "System (payment terms)",
      status: "Pending", is_production_blocking: false, resolved_by_id: null, created_at: new Date().toISOString(), resolved_at: null,
    });
    await decideException(store, actors.owner, ex.id, "Approved");
    expect((await startProduction(store, actors.staff, id)).status).toBe("In Production"); // ₱0 paid
  });

  it("the owner approves the installment plan from the order, then production can start", async () => {
    const { store, id } = await accepted("installment");
    expect((await err(approveInstallmentPlan(store, actors.staff, id))).code).toBe("FORBIDDEN");
    const ex = await approveInstallmentPlan(store, actors.owner, id); // no pending item yet: created and approved
    expect(ex).toMatchObject({ category: "Installment Approval", status: "Approved" });
    expect((await store.getOrder(id))!.payment_exception_approved).toBe(true);
    expect((await err(approveInstallmentPlan(store, actors.owner, id))).message).toMatch(/already approved/);
    expect((await startProduction(store, actors.staff, id)).status).toBe("In Production");
  });

  it("only installment orders can be approved this way", async () => {
    const { store, id } = await accepted("full");
    expect((await err(approveInstallmentPlan(store, actors.owner, id))).message).toMatch(/did not choose installment/);
  });
});
