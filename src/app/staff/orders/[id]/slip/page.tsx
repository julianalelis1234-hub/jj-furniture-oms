import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DemoBar } from "@/components/demo-bar";
import { LinkButton } from "@/components/link-button";
import { isDemoMode } from "@/lib/config";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { nameOf } from "@/lib/server/office-data";
import { PrintButton, SlipQr } from "./slip-client";

export const metadata = { title: "Confirmation Slip" };

export default async function SlipPage({ params, searchParams }: PageProps<"/staff/orders/[id]/slip">) {
  await requireActor(["staff", "owner"]);
  const { id } = await params;
  const isNew = (await searchParams).new === "1";
  const store = await getStore();
  const o = await store.getOrder(id);
  if (!o) notFound();
  if (o.status === "Quote Requested") redirect(`/staff/orders/${o.id}`); // no quotation, no slip yet
  const profiles = await store.listProfiles();
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const trackUrl = `${origin}/track?code=${encodeURIComponent(o.order_code)}`;
  const down = o.standard_down_payment_due;

  return (
    <div className="min-h-dvh bg-background">
      {isDemoMode() && <DemoBar current="staff" />}
      <div className="p-4">
      <div className="no-print mx-auto mb-4 flex max-w-xl flex-wrap gap-2">
        <LinkButton href={`/staff/orders/${o.id}`} variant="ghost"><ArrowLeft aria-hidden /> Back to order</LinkButton>
        <PrintButton />
      </div>
      {isNew && (
        <div className="no-print mx-auto mb-4 flex max-w-xl items-start gap-2 rounded-xl border border-success bg-success-soft p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p>
            <b>Order saved on the server as {o.order_code}.</b> Give this slip to the customer (or send a photo by Messenger).
            {o.customer_email
              ? <>A single-use link to review and accept the quotation was emailed to <b>{o.customer_email}</b>.</>
              : <>Walk-in order: the customer accepts at the counter (signed slip); there is no portal login.</>}
          </p>
        </div>
      )}

      <article className="print-sheet mx-auto max-w-xl rounded-xl border bg-white p-6 text-black shadow-sm">
        <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
          <div>
            <p className="text-lg font-black">JJ FURNITURE SHOP AND ENTERPRISES</p>
            <p className="text-xs">Poblacion, Valencia City, Bukidnon</p>
            <p className="mt-2 text-sm font-bold tracking-wide uppercase">Specification Confirmation Slip</p>
            <p className="text-xs tabular-nums">Specification revision {o.current_revision ?? "—"}{o.approved_revision_number ? ` · confirmed` : " · awaiting customer confirmation"}</p>
          </div>
          <SlipQr value={trackUrl} />
        </header>

        <section className="grid grid-cols-3 gap-2 border-b border-black py-3 text-center">
          <div><p className="text-[0.65rem] uppercase">Order ID</p><p className="font-mono text-base font-black">{o.order_code}</p></div>
          <div><p className="text-[0.65rem] uppercase">Paper Slip #</p><p className="font-mono text-base font-black">{o.paper_slip_number}</p></div>
          {o.pin_code_display ? (
            <div><p className="text-[0.65rem] uppercase">Customer PIN</p><p className="font-mono text-xl font-black tracking-[0.3em]">{o.pin_code_display}</p></div>
          ) : (
            <div><p className="text-[0.65rem] uppercase">Customer updates</p><p className="text-xs font-bold break-all" data-testid="slip-contact">{o.customer_email ?? "Walk-in · paper slip only"}</p></div>
          )}
        </section>

        <section className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-black py-3 text-sm">
          <span>Customer</span><b>{o.customer_name} · {o.customer_phone}</b>
          <span>Deliver to</span><b>{o.delivery_address}, {o.municipality}</b>
          <span>Item</span><b>{o.quantity} × {o.item_name}</b>
          {o.design_variant && (<><span>Design</span><b>{o.furniture_category} · {o.design_variant}</b></>)}
          <span>Dimensions</span><b className="tabular-nums">{o.width_cm != null ? `W ${o.width_cm} × H ${o.height_cm} × D ${o.depth_cm} cm` : `${o.dimensions} (pending clarification)`}</b>
          <span>Wood</span><b>{o.wood_type}{o.custom_wood_note ? ` — ${o.custom_wood_note}` : ""}</b>
          <span>Color / finish</span><b>{o.color_finish}</b>
          {o.special_instructions && (<><span>Notes</span><b className="whitespace-pre-line">{o.special_instructions}</b></>)}
        </section>

        <section className="grid grid-cols-2 gap-3 border-b border-black py-3 text-center">
          <div className="rounded border border-black p-2"><p className="text-[0.65rem] uppercase">Estimated completion</p><p className="font-bold">{formatDate(o.estimated_completion_date)}</p></div>
          <div className="rounded border border-black p-2"><p className="text-[0.65rem] uppercase">Scheduled delivery</p><p className="font-bold">{formatDate(o.scheduled_delivery_date)}</p></div>
        </section>

        <section className="border-b border-black py-3 text-sm">
          <div className="flex justify-between"><span>Furniture price</span><b>{formatPeso(o.furniture_price)}</b></div>
          <div className="flex justify-between"><span>30% down payment (before production)</span><b>{formatPeso(down)}</b></div>
          <div className="flex justify-between"><span>70% balance (on delivery)</span><b>{formatPeso((o.furniture_price ?? 0) - down)}</b></div>
          <div className="flex justify-between"><span>Delivery fee</span><b>{o.delivery_fee === 0 ? "FREE (Valencia City)" : formatPeso(o.delivery_fee)}</b></div>
          <div className="mt-1 flex justify-between border-t border-black pt-1 text-base"><span className="font-bold">Collect on delivery (after 30%)</span><b>{formatPeso((o.furniture_price ?? 0) - down + o.delivery_fee)}</b></div>
          {o.payment_exception_type !== "Standard 30/70" && <p className="mt-1 text-xs">Payment terms: {o.payment_exception_type}{o.payment_exception_approved ? " (approved by owner)" : " (pending owner approval)"}</p>}
        </section>

        <section className="py-3 text-xs">
          <p>
            Track your order: scan the QR code or visit <b>{origin.replace(/^https?:\/\//, "")}/track</b> and enter your Order ID.
            {o.pin_code_display
              ? "Use your PIN to see the payment summary and confirm the specifications. Keep your PIN private."
              : o.customer_email
                ? "Your quotation review link is sent by email. After you accept, set your password and log in at /customer/login to follow all your orders."
                : "Walk-in order: ask the shop for updates; status by Order ID is always available online."}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-6">
            <div className="border-t border-black pt-1 text-center">Customer signature (specs &amp; price confirmed)</div>
            <div className="border-t border-black pt-1 text-center">Encoded by: {nameOf(profiles, o.encoded_by_id)}</div>
          </div>
        </section>
      </article>
      </div>
    </div>
  );
}
