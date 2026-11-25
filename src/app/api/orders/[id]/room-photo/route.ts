import { getActor, getStore } from "@/lib/server/context";
import { getRoomPhotoStore } from "@/lib/server/proof-store";

/**
 * Staff/owner view of the photo a customer took of their room. Streamed through
 * the server after an office-role check; the storage bucket is never public.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || (actor.role !== "owner" && actor.role !== "staff")) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const order = await (await getStore()).getOrder(id);
  if (!order?.room_photo_path) return new Response("Not found", { status: 404 });
  const file = await getRoomPhotoStore().get(order.room_photo_path);
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
