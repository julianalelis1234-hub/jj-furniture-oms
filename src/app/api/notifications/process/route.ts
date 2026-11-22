import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/email/outbox";
import { getPublicStore } from "@/lib/server/context";
import { getCustomerAuth } from "@/lib/server/customer-auth";
import { cronAuthorized } from "@/lib/server/request-meta";

export const maxDuration = 60;

/**
 * Queue worker — scheduler ONLY (POST with `Authorization: Bearer ${CRON_SECRET}`).
 * Staff / owner / customer sessions are irrelevant here and always refused, so
 * nobody can trigger queue-wide processing from a browser.
 */
export async function POST(req: Request) {
  const auth = cronAuthorized(req.headers.get("authorization"));
  if (auth === "disabled") return NextResponse.json({ error: "Queue processing is not configured" }, { status: 503 });
  if (auth !== "ok") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const store = await getPublicStore();
    const summary = await processOutbox(store, { auth: await getCustomerAuth() }, { limit: 25 });
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[outbox] batch failed:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Batch failed" }, { status: 500 });
  }
}
