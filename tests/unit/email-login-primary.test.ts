import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toClientOrder } from "@/lib/client-order";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DomainError } from "@/lib/domain/errors";
import { customerDashboard, customerOwnedOrder, customerOwnedRequest } from "@/lib/services/customer-portal";
import { createOrder, editOrderDetails, startProduction } from "@/lib/services/orders";
import { actors, payDown, seededStore, staffAccept, validOrderInput } from "./helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("expected an error");
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("Order ID + PIN lookup is retired; email login is Option 1", () => {
  it("no active PIN endpoint, action, route or helper remains in the app", async () => {
    const src = sourceFiles("src").map((f) => [f, readFileSync(f, "utf8")] as const);
    for (const banned of ["customer_verify_pin", "customer_track", "customerVerifyPin", "customerTrack", "customerLookupAction", "verifyPinHash", "generatePin", "pinSchema", "jj_customer\""]) {
      expect(src.filter(([, t]) => t.includes(banned)).map(([f]) => f), banned).toEqual([]);
    }
    expect(src.some(([f]) => f.includes(join("app", "track")))).toBe(false);
    const store = (await seededStore()) as MemoryStore;
    expect("customerVerifyPin" in store).toBe(false);
    expect("customerTrack" in store).toBe(false);
  });

  it("historical PIN data is preserved in the record but never sent to browsers", async () => {
    const store = (await seededStore()) as MemoryStore;
    const legacy = (await store.getOrderByCode("JJ-2026-0133"))!;
    expect(legacy.pin_code_hash).toMatch(/^\$2a\$/); // kept for the audit trail
    expect(legacy.legacy_contact_unknown).toBe(true);
    const client = toClientOrder(legacy) as Record<string, unknown>;
    expect("pin_code_hash" in client).toBe(false);
    expect("pin_code_display" in client).toBe(false);
  });

  it("legacy unlinked orders stay manageable by staff/owner and are never auto-linked by a matching email", async () => {
    const store = (await seededStore()) as MemoryStore;
    const maria = store.t.customer_accounts[0];
    const legacy = (await store.getOrderByCode("JJ-2026-0133"))!;
    expect(legacy.customer_user_id).toBeNull();
    // staff record Maria's email on the old order: same address as her account
    const edited = await editOrderDetails(store, actors.staff, legacy.id, {
      customer_email: maria.email, has_no_email: "", customer_phone: legacy.customer_phone, delivery_address: legacy.delivery_address,
      municipality: legacy.municipality, delivery_fee: legacy.delivery_fee, estimated_completion_date: legacy.estimated_completion_date ?? "", scheduled_delivery_date: "",
    });
    expect(edited.customer_email).toBe(maria.email);
    expect(edited.customer_user_id).toBeNull();
    expect(edited.email_verified_at).toBeNull();
    const codes = (await customerDashboard(store, maria.id)).map((d) => d.view.order_code);
    expect(codes).not.toContain("JJ-2026-0133");
    expect((await err(customerOwnedOrder(store, maria.id, "JJ-2026-0133"))).code).toBe("NOT_FOUND");
    // owner still sees and manages it
    expect((await store.listOrders()).some((o) => o.id === legacy.id)).toBe(true);
  });

  it("post-confirmation change / repair requests: own orders only", async () => {
    const store = (await seededStore()) as MemoryStore;
    const maria = store.t.customer_accounts[0];
    const r = await customerOwnedRequest(store, maria.id, "JJ-2026-0145", "Please add a felt pad under each leg.", "repair");
    expect(r.requested_by).toBe("Customer (portal)");
    expect((await err(customerOwnedRequest(store, maria.id, "JJ-2026-0136", "Make it bigger please", "change"))).code).toBe("NOT_FOUND");
    expect((await err(customerOwnedRequest(store, "c0000000-0000-4000-8000-00000000ffff", "JJ-2026-0145", "Make it bigger please", "change"))).code).toBe("NOT_FOUND");
  });

  it("approval / production rules are unchanged: accept_order_revision, then production only after the verified 30%", async () => {
    const store = (await seededStore()) as MemoryStore;
    const { order } = await createOrder(store, actors.staff, validOrderInput({ customer_email: "gate.check@example.com", furniture_price: "20000" }));
    const confirmed = await staffAccept(store, actors.staff, order.id);
    expect(confirmed.status).toBe("Confirmed");
    expect((await err(startProduction(store, actors.owner, order.id))).message).toMatch(/30%|down payment/i);
    await payDown(store, order.id);
    expect((await startProduction(store, actors.owner, order.id)).status).toBe("In Production");
  });
});

describe("Demo Customer Login (Maria Santos)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("is refused on the server outside Demo Mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_MODE", "production");
    vi.resetModules();
    const { demoCustomerLoginAction } = await import("@/app/customer/actions");
    const r = await demoCustomerLoginAction();
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
