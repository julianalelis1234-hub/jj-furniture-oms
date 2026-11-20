import { NextResponse } from "next/server";
import { DomainError } from "@/lib/domain/errors";
import { getActor, getStore } from "@/lib/server/context";
import { driverManifest } from "@/lib/services/deliveries";

/** Assignments a driver pre-loads into IndexedDB before leaving the shop. */
export async function GET() {
  const actor = await getActor();
  if (!actor || actor.role !== "driver") return NextResponse.json({ error: "Drivers only" }, { status: 403 });
  try {
    const entries = await driverManifest(await getStore(), actor);
    return NextResponse.json({ driver_id: actor.id, server_time: new Date().toISOString(), entries }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof DomainError && e.code === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status });
  }
}
