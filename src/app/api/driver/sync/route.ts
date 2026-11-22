import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor, getStore } from "@/lib/server/context";
import { withActorRole } from "@/lib/realtime/actor-context";
import { applyDriverAction } from "@/lib/services/deliveries";

const actionSchema = z.object({
  client_transaction_id: z.uuid(),
  type: z.enum(["start_trip", "delivered", "failed"]),
  delivery_id: z.uuid(),
  order_id: z.uuid(),
  base_version: z.number().int().positive(),
  queued_at: z.string().max(40),
  amount_collected: z.number().nonnegative().max(99_999_999).optional(),
  payment_method: z.enum(["Cash", "GCash / Bank Transfer"]).optional(),
  notes: z.string().max(1000).optional(),
  needs_touch_up: z.boolean().optional(),
});

/**
 * Single endpoint for driver actions, used both for live clicks and for
 * replaying the offline IndexedDB queue. Idempotent on client_transaction_id.
 */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor || actor.role !== "driver") return NextResponse.json({ error: "Drivers only" }, { status: 403 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action payload" }, { status: 400 });
  try {
    const result = await withActorRole("driver", async () => applyDriverAction(await getStore(), actor, parsed.data));
    return NextResponse.json(result, { status: result.status === "conflict" ? 409 : 200 });
  } catch (e) {
    console.error("[driver-sync]", e);
    return NextResponse.json({ error: "Server error — action kept in your phone queue" }, { status: 500 });
  }
}
