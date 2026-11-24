"use client";

import Link from "next/link";
import { CheckCircle2, Clock, FileClock, KeyRound, MailCheck, RotateCcw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { reviewAcceptAction, reviewProposeAction } from "@/app/customer/actions";
import { ActionDialog } from "@/components/action-dialog";
import { useServerAction } from "@/components/form";
import { LinkButton } from "@/components/link-button";
import { configFromSpec, configToSpec, FurnitureConfigurator, type ConfigValue } from "@/components/orders/FurnitureConfigurator";
import { Button } from "@/components/ui/button";
import { describeDiff, diffSpecs } from "@/lib/domain/furniture";
import { formatDateTime } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import type { ProvisionResult, ReviewView } from "@/lib/services/customer-portal";
import { newUuid } from "@/lib/uuid";

function Done({ result }: { result: (ProvisionResult & { demo_setup_path?: string }) | null }) {
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
          This order was added to your existing JJ Enterprises account. Log in with your usual password, or <Link href="/customer/forgot-password" className="font-semibold underline">reset it</Link> if you forgot it.</p>
      )}
      {result && !["setup_email_sent", "linked"].includes(result.status) && (
        <p className="text-sm">Your account details will follow by email. Your acceptance is saved either way.</p>
      )}
      {result?.demo_setup_path ? (
        <div className="grid gap-1.5 rounded-xl border border-dashed border-live bg-background p-3" data-testid="demo-setup-shortcut">
          <LinkButton href={result.demo_setup_path} variant="default" size="xl" className="w-full rounded-full"><KeyRound aria-hidden /> Set your password now</LinkButton>
          <p className="text-xs text-muted-foreground">Demo Mode shortcut: this is the same single-use link that was emailed (also in the Demo Inbox). Real customers get it only by email.</p>
        </div>
      ) : (
        <LinkButton href="/customer/login" variant="default" className="w-full sm:w-auto"><KeyRound aria-hidden /> Customer login</LinkButton>
      )}
    </div>
  );
}

/** Review + accept (or propose changes to) ONE quotation revision, scoped by the server-side review session. */
export function ReviewQuote({ view }: { view: ReviewView }) {
  const router = useRouter();
  const [key] = useState(() => newUuid());
  const [result, setResult] = useState<(ProvisionResult & { demo_setup_path?: string }) | null>(null);
  const [accepted, setAccepted] = useState(view.accepted);
  const cur = view.order.current;
  const initial = useMemo<ConfigValue | null>(() => (cur ? configFromSpec(cur.spec) : null), [cur]);
  const [config, setConfig] = useState<ConfigValue | null>(initial);
  const { pending, run, errors } = useServerAction();

  if (accepted) return <Done result={result} />;
  if (view.proposal_pending)
    return (
      <p className="flex gap-2 rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm" data-testid="review-proposal-sent">
        <FileClock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        Your proposed changes were sent. JJ Enterprises will check the price and delivery impact and email you a revised quotation with a new link.
      </p>
    );
  if (!view.scope_current)
    return <p className="rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm">A newer quotation was issued for this order. Please open the link in the most recent email from JJ Enterprises.</p>;
  // migration 009: a quotation is accepted while the order is Confirmed and not yet accepted
  if (view.order.spec_state !== "awaiting_acceptance" && view.order.spec_state !== "quote_expired" || !cur || !config || !initial)
    return <p className="rounded-xl border bg-card p-4 text-sm">This quotation is no longer waiting for acceptance. Log in to see your order.</p>;
  if (view.quote_expired)
    return (
      <p className="flex gap-2 rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm" data-testid="review-expired">
        <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        This quotation expired on {formatDateTime(cur.expires_at!)}. Please contact JJ Enterprises for a fresh quotation.
      </p>
    );

  const price = cur.quoted_furniture_price ?? 0;
  const fee = cur.quoted_delivery_fee ?? 0;
  const changes = diffSpecs(configToSpec(initial) as unknown as Record<string, unknown>, configToSpec(config) as unknown as Record<string, unknown>);
  const changed = Object.keys(changes).length > 0;
  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Quotation · revision {view.revision_number}</h2>
        {cur.expires_at && <span className="flex items-center gap-1 text-sm"><Clock className="size-4 text-primary" aria-hidden /> valid until <b>{formatDateTime(cur.expires_at)}</b></span>}
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(() => reviewProposeAction(fd), () => router.refresh());
        }}
      >
        <FurnitureConfigurator
          value={config}
          onChange={setConfig}
          errors={errors}
          legacyDimensions={cur.legacy_dimensions_text}
          previewFooter={
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-t px-3 py-2 text-sm">
              <dt>Furniture price</dt><dd className="font-bold tabular-nums">{formatPeso(price)}</dd>
              <dt>Delivery fee</dt><dd className="tabular-nums">{fee === 0 ? "FREE" : formatPeso(fee)}</dd>
              <dt className="font-semibold">Total</dt><dd className="font-black tabular-nums">{formatPeso(price + fee)}</dd>
            </dl>
          }
        />
        <div className="grid gap-2 rounded-xl border bg-secondary/50 p-3">
          {changed ? (
            <>
              <p className="text-sm"><b>Your changes:</b> <span className="tabular-nums">{describeDiff(changes)}</span></p>
              <p className="text-xs text-muted-foreground">Changes may affect the price. The shop will email you a revised quotation; nothing is approved until you accept it.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="submit" size="xl" className="h-auto min-h-12 py-2 whitespace-normal" disabled={pending}>
                  <Send aria-hidden /> Submit Specification Changes for Review
                </Button>
                <Button type="button" size="xl" variant="outline" onClick={() => setConfig(initial)} disabled={pending}>
                  <RotateCcw aria-hidden /> Undo my changes
                </Button>
              </div>
            </>
          ) : (
            <ActionDialog
              trigger="Accept Quote & Confirm Specifications"
              icon={<CheckCircle2 aria-hidden />}
              size="xl"
              variant="success"
              triggerClassName="h-auto min-h-12 w-full py-2 whitespace-normal"
              title={`Accept revision ${view.revision_number}?`}
              description="Tick both boxes to accept this exact specification and this exact quotation. Production starts after your 30% down payment is verified."
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
                I accept these specifications (revision {view.revision_number}: {cur.spec.design_variant}, {cur.spec.width_cm} × {cur.spec.height_cm} × {cur.spec.depth_cm} cm, {cur.spec.wood_type}, {cur.spec.color_finish}).
              </label>
              <label className="flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold">
                <input type="checkbox" name="accept_quotation" required className="mt-0.5 size-5" data-testid="accept-quotation" />
                I accept this quotation: {formatPeso(price)} + {fee === 0 ? "free delivery" : `${formatPeso(fee)} delivery`} = {formatPeso(price + fee)}; 30% down payment {formatPeso(Math.round(price * 30) / 100)}.
              </label>
            </ActionDialog>
          )}
        </div>
      </form>
    </div>
  );
}
