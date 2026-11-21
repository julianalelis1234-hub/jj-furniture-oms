"use client";

import { CheckCircle2, Clock, KeyRound, MailCheck } from "lucide-react";
import { useState } from "react";
import { reviewAcceptAction } from "@/app/customer/actions";
import { ActionDialog } from "@/components/action-dialog";
import { LinkButton } from "@/components/link-button";
import { FurniturePreviewSlot } from "@/components/orders/preview-slot";
import { formatDateTime } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import type { ProvisionResult, ReviewView } from "@/lib/services/customer-portal";
import { newUuid } from "@/lib/uuid";

function Done({ result }: { result: ProvisionResult | null }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-success bg-success-soft p-5" data-testid="review-accepted">
      <p className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 className="size-6 text-success" aria-hidden /> Quotation accepted — your order is confirmed</p>
      <p className="text-sm">Production starts once your 30% down payment is verified by the shop.</p>
      {result?.status === "setup_email_sent" && (
        <p className="flex gap-2 text-sm" data-testid="setup-email-sent"><MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          We emailed you a link to <b>create your password</b>. It works once and expires in 24 hours. Then log in to follow all your orders.</p>
      )}
      {result?.status === "linked" && (
        <p className="flex gap-2 text-sm" data-testid="order-linked"><KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          This order was added to your existing JJ Furniture account. Log in with your usual password.</p>
      )}
      {result && !["setup_email_sent", "linked"].includes(result.status) && (
        <p className="text-sm">Your account details will follow by email. Your acceptance is saved either way.</p>
      )}
      <LinkButton href="/customer/login" variant="default" className="w-full sm:w-auto"><KeyRound aria-hidden /> Customer login</LinkButton>
    </div>
  );
}

/** Review + accept ONE quotation revision (scoped by the server-side review session). */
export function ReviewQuote({ view }: { view: ReviewView }) {
  const [key] = useState(() => newUuid());
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [accepted, setAccepted] = useState(view.accepted);
  const cur = view.order.current;

  if (accepted) return <Done result={result} />;
  if (!view.scope_current)
    return <p className="rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm">A newer quotation was issued for this order. Please open the link in the most recent email from JJ Furniture.</p>;
  if (view.order.status !== "Waiting for Confirmation" || !cur)
    return <p className="rounded-xl border bg-card p-4 text-sm">This quotation is no longer waiting for acceptance. Log in to see your order.</p>;
  if (view.quote_expired)
    return (
      <p className="flex gap-2 rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm" data-testid="review-expired">
        <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        This quotation expired on {formatDateTime(cur.expires_at!)}. Please contact JJ Furniture for a fresh quotation.
      </p>
    );

  const price = cur.quoted_furniture_price ?? 0;
  const fee = cur.quoted_delivery_fee ?? 0;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:items-start">
      <div className="grid gap-3 rounded-2xl border bg-card p-4">
        <h2 className="text-lg font-bold">Quotation · revision {view.revision_number}</h2>
        {cur.expires_at && <p className="flex items-center gap-2 text-sm"><Clock className="size-4 text-primary" aria-hidden /> Valid until <b>{formatDateTime(cur.expires_at)}</b></p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Design</dt><dd className="font-semibold">{cur.spec.design_variant} {cur.spec.furniture_category}</dd>
          <dt className="text-muted-foreground">Size</dt><dd className="font-semibold tabular-nums">{cur.spec.width_cm} × {cur.spec.height_cm} × {cur.spec.depth_cm} cm (W × H × D)</dd>
          <dt className="text-muted-foreground">Wood</dt><dd className="font-semibold">{cur.spec.wood_type}{cur.spec.custom_wood_note ? ` (${cur.spec.custom_wood_note})` : ""}</dd>
          <dt className="text-muted-foreground">Finish</dt><dd className="font-semibold">{cur.spec.color_finish}</dd>
          <dt className="text-muted-foreground">Quantity</dt><dd className="font-semibold tabular-nums">{cur.spec.quantity}</dd>
        </dl>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3 text-sm">
          <dt>Furniture price</dt><dd className="font-bold tabular-nums">{formatPeso(price)}</dd>
          <dt>Delivery fee</dt><dd className="tabular-nums">{fee === 0 ? "FREE" : formatPeso(fee)}</dd>
          <dt className="font-semibold">Total</dt><dd className="font-black tabular-nums">{formatPeso(price + fee)}</dd>
          <dt className="text-muted-foreground">30% down payment before production</dt><dd className="tabular-nums">{formatPeso(Math.round(price * 30) / 100)}</dd>
        </dl>
        <ActionDialog
          trigger="Accept Quote & Confirm Specifications"
          icon={<CheckCircle2 aria-hidden />}
          size="xl"
          variant="success"
          triggerClassName="h-auto min-h-12 w-full py-2 whitespace-normal"
          title={`Accept revision ${view.revision_number}?`}
          description="Tick both boxes to accept this exact specification and this exact quotation."
          submitLabel="Accept quote & confirm"
          submitVariant="success"
          action={async (fd) => {
            const r = await reviewAcceptAction({
              accepted_furniture_price: price,
              accepted_delivery_fee: fee,
              client_idempotency_key: key,
              accept_specification: fd.get("accept_specification") === "on",
              accept_quotation: fd.get("accept_quotation") === "on",
            });
            if (r.ok) { setResult(r.data ?? null); setAccepted(true); }
            return r;
          }}
        >
          <label className="flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold">
            <input type="checkbox" name="accept_specification" required className="mt-0.5 size-5" data-testid="accept-specification" />
            I accept these specifications (revision {view.revision_number}).
          </label>
          <label className="flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold">
            <input type="checkbox" name="accept_quotation" required className="mt-0.5 size-5" data-testid="accept-quotation" />
            I accept this quotation: {formatPeso(price + fee)} total{cur.expires_at ? `, valid until ${formatDateTime(cur.expires_at)}` : ""}.
          </label>
        </ActionDialog>
      </div>
      <FurniturePreviewSlot spec={cur.spec} />
    </div>
  );
}
