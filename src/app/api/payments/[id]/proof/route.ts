import { getActor, getStore } from "@/lib/server/context";
import { getProofStore } from "@/lib/server/proof-store";

/**
 * Staff/owner view of a customer's receipt. The file is streamed through the
 * server after an office-role check; it is never publicly addressable.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || (actor.role !== "owner" && actor.role !== "staff")) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const payment = (await (await getStore()).listPayments()).find((p) => p.id === id);
  if (!payment?.proof_path) return new Response("Not found", { status: 404 });
  const file = await getProofStore().get(payment.proof_path);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
