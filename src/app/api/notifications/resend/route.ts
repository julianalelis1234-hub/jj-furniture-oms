import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "@/lib/domain/errors";
import { resendForOrder } from "@/lib/email/requests";
import { getActor, getStore } from "@/lib/server/context";
import { getCustomerAuth } from "@/lib/server/customer-auth";

const body = z.object({ order_id: z.uuid(), kind: z.enum(["quote_review", "account_setup"]) });

/** Staff / owner only: resend ONE order's quotation link or account email (audited, rate-limited). */
export async function POST(req: Request) {
  const actor = await getActor(); // customers never resolve to an actor
  if (!actor) return NextResponse.json({ error: "Sign in as staff" }, { status: 401 });
  if (actor.role !== "staff" && actor.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const r = await resendForOrder(await getStore(), await getCustomerAuth(), actor, parsed.data.order_id, parsed.data.kind);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof DomainError) {
      const status = e.code === "RATE_LIMITED" ? 429 : e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("[resend] failed:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
