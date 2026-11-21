"use client";

import { CheckCircle2, Clock, FileClock, Hammer, RotateCcw, Send, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { customerAcceptAction, customerProposeAction, customerRepairAction } from "@/app/actions";
import { ActionDialog } from "@/components/action-dialog";
import { Field, NativeSelect, TextArea, useServerAction } from "@/components/form";
import { configFromSpec, configToSpec, FurnitureConfigurator, type ConfigValue } from "@/components/orders/FurnitureConfigurator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/domain/dates";
import { newUuid } from "@/lib/uuid";
import { formatPeso } from "@/lib/domain/finance";
import { describeDiff, diffSpecs, isConfiguratorFinish } from "@/lib/domain/furniture";
import type { CustomerOrderView } from "@/lib/services/customer";

const REV_LABEL: Record<string, string> = {
  staff_draft: "Shop quotation",
  customer_request: "Your design request",
  customer_proposal: "Your proposal",
  revised_quote: "Revised shop quote",
  final_approved: "Final approved",
};

/**
 * Customer specification review (CU-01):
 *  - Quote Requested (Option 2): read-only until the shop issues the official quotation.
 *  - Waiting for Confirmation (valid quotation): explore wood, design, size and finish live.
 *    Unchanged -> [Accept Quote & Confirm Specifications] (this exact revision + quotation,
 *                 with two explicit acceptances recorded atomically).
 *    Changed   -> [Submit Specification Changes for Review] (new proposal revision).
 *  - Expired quotation: cannot be accepted until the shop issues a fresh one.
 *  - After production starts: read-only, "Locked — Confirmed for Workshop Production",
 *    and [Request Post-Confirmation Change / Repair].
 */
export function SpecReview({ view: v }: { view: CustomerOrderView }) {
  const router = useRouter();
  const current = v.current;
  const initial = useMemo<ConfigValue | null>(() => (current ? configFromSpec(current.spec) : null), [current]);
  const [config, setConfig] = useState<ConfigValue | null>(initial);
  const { pending, run, errors } = useServerAction();
  // one idempotency key per page view: retries and double taps can never record two acceptances
  const [acceptKey] = useState(() => newUuid());

  if (!current || !config || !initial) return null;
  const editable = v.spec_state === "awaiting_confirmation";
  const legacyFinish = !isConfiguratorFinish(current.spec.color_finish);
  const changes = diffSpecs(configToSpec(initial) as unknown as Record<string, unknown>, configToSpec(config) as unknown as Record<string, unknown>);
  const changed = Object.keys(changes).length > 0;
  const quote = v.quote;

  return (
    <Card className={editable ? "border-accent/70" : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Your furniture specification
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
            Revision {current.revision_number} · {REV_LABEL[current.revision_type]}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {v.spec_state === "quote_requested" && (
          <p className="flex gap-2 rounded-lg border border-primary/40 bg-secondary p-3 text-sm" data-testid="quote-requested-banner">
            <FileClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <b>We received your design request.</b> JJ Furniture will check the size, wood and finish and send you an official
              quotation (price and delivery fee). It will appear on this page for you to accept. Nothing is ordered or charged yet.
            </span>
          </p>
        )}
        {v.spec_state === "quote_expired" && (
          <p className="flex gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm" data-testid="quote-expired-banner">
            <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              <b>This quotation expired on {formatDateTime(current.expires_at!)}.</b> Prices can change, so it can no longer be accepted.
              Please message or call JJ Furniture for a fresh quotation.
            </span>
          </p>
        )}
        {v.spec_state === "awaiting_confirmation" && current.expires_at && (
          <p className="flex items-center gap-2 text-sm" data-testid="quote-validity">
            <Clock className="size-4 shrink-0 text-primary" aria-hidden />
            <span>
              Quotation issued {current.quoted_at ? formatDateTime(current.quoted_at) : ""} · <b>valid until {formatDateTime(current.expires_at)}</b>
            </span>
          </p>
        )}
        {v.spec_state === "awaiting_confirmation" && (
          <p className="rounded-lg bg-accent-soft p-3 text-sm">
            Review the specification below. You can try other woods, designs, sizes and finishes — the preview updates as you choose.
            {legacyFinish && " Your current finish was recorded before the configurator; pick one of the four finishes to propose a change."}
          </p>
        )}
        {v.spec_state === "proposal_under_review" && (
          <p className="flex gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
            <FileClock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              <b>Your proposed changes (revision {current.revision_number}) are being reviewed by JJ Furniture.</b> They will check the price and
              delivery impact and send a revised quote for you to confirm. Production stays on hold until then.
            </span>
          </p>
        )}
        {v.spec_state === "needs_shop_review" && (
          <p className="flex gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>The shop is finishing a review on your order (for example a payment-terms approval). You can confirm once it is done.</span>
          </p>
        )}
        {v.spec_state === "legacy_needs_spec" && (
          <p className="flex gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>This order was recorded before exact width, height and depth were captured. The shop will send an updated quote with the exact measurements for you to confirm.</span>
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => customerProposeAction(current.revision_number, fd), () => router.refresh());
          }}
          className="grid gap-4"
          aria-label="Specification"
        >
          <FurnitureConfigurator
            value={config}
            onChange={setConfig}
            errors={errors}
            readOnly={!editable}
            lockedLabel={
              v.spec_state === "locked"
                ? v.status === "Confirmed"
                  ? "Confirmed — locks for workshop production once your 30% down payment is verified"
                  : "Locked — Confirmed for Workshop Production"
                : v.spec_state === "quote_requested"
                  ? "Read-only while the shop prepares your quotation"
                  : v.spec_state === "quote_expired"
                    ? "Quotation expired — waiting for a fresh quotation"
                    : "Read-only while the shop reviews"
            }
            legacyDimensions={current.legacy_dimensions_text}
            previewFooter={
              !quote ? (
                <p className="border-t px-3 py-2 text-sm text-muted-foreground">Quotation pending — the shop will add the price and delivery fee.</p>
              ) : (
                <div className="border-t px-3 py-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Quoted price (rev. {quote.revision_number})</span><b className="tabular-nums">{formatPeso(quote.quoted_furniture_price)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Delivery fee</span><span className="tabular-nums">{quote.quoted_delivery_fee === 0 ? "FREE" : formatPeso(quote.quoted_delivery_fee)}</span></div>
                </div>
              )
            }
          />

          {editable && (
            <div className="grid gap-2 rounded-xl border bg-secondary/50 p-3">
              {changed ? (
                <>
                  <p className="text-sm"><b>Your changes:</b> <span className="tabular-nums">{describeDiff(changes)}</span></p>
                  <p className="text-xs text-muted-foreground">
                    Changes may affect the price or delivery fee. The shop will review them and send a revised quote; nothing is approved until you confirm it.
                  </p>
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
                  title={`Accept revision ${current.revision_number}?`}
                  description="Tick both boxes to accept this exact specification and this exact quotation. Production starts after your 30% down payment is verified."
                  submitLabel="Accept quote & confirm"
                  submitVariant="success"
                  action={(fd) =>
                    customerAcceptAction({
                      revision_id: current.revision_id,
                      expected_revision_number: current.revision_number,
                      accepted_furniture_price: current.quoted_furniture_price ?? 0,
                      accepted_delivery_fee: current.quoted_delivery_fee ?? 0,
                      client_idempotency_key: acceptKey,
                      accept_specification: fd.get("accept_specification") === "on",
                      accept_quotation: fd.get("accept_quotation") === "on",
                    })
                  }
                  onDone={() => router.refresh()}
                >
                  <fieldset className="grid gap-2 rounded-lg border p-3 text-sm">
                    <legend className="px-1 font-semibold">Specification · revision {current.revision_number}</legend>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Design</dt><dd className="font-semibold">{current.spec.design_variant} {current.spec.furniture_category}</dd>
                      <dt className="text-muted-foreground">Size</dt><dd className="font-semibold tabular-nums">{current.spec.width_cm} × {current.spec.height_cm} × {current.spec.depth_cm} cm</dd>
                      <dt className="text-muted-foreground">Wood</dt><dd className="font-semibold">{current.spec.wood_type}{current.spec.custom_wood_note ? ` (${current.spec.custom_wood_note})` : ""}</dd>
                      <dt className="text-muted-foreground">Finish</dt><dd className="font-semibold">{current.spec.color_finish}</dd>
                      <dt className="text-muted-foreground">Quantity</dt><dd className="font-semibold tabular-nums">{current.spec.quantity}</dd>
                    </dl>
                    <label className="flex items-start gap-2 font-semibold">
                      <input type="checkbox" name="accept_specification" required className="mt-0.5 size-5" data-testid="accept-specification" />
                      I accept these specifications.
                    </label>
                  </fieldset>
                  <fieldset className="grid gap-2 rounded-lg border p-3 text-sm">
                    <legend className="px-1 font-semibold">Quotation</legend>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Furniture price</dt><dd className="font-bold tabular-nums">{formatPeso(current.quoted_furniture_price)}</dd>
                      <dt className="text-muted-foreground">Delivery fee</dt><dd className="tabular-nums">{current.quoted_delivery_fee === 0 ? "FREE" : formatPeso(current.quoted_delivery_fee)}</dd>
                      <dt className="font-semibold">Total</dt><dd className="font-black tabular-nums">{formatPeso((current.quoted_furniture_price ?? 0) + (current.quoted_delivery_fee ?? 0))}</dd>
                      <dt className="text-muted-foreground">30% down payment</dt><dd className="tabular-nums">{formatPeso(Math.round((current.quoted_furniture_price ?? 0) * 30) / 100)}</dd>
                      {current.expires_at && (<><dt className="text-muted-foreground">Valid until</dt><dd className="tabular-nums">{formatDateTime(current.expires_at)}</dd></>)}
                    </dl>
                    <label className="flex items-start gap-2 font-semibold">
                      <input type="checkbox" name="accept_quotation" required className="mt-0.5 size-5" data-testid="accept-quotation" />
                      I accept this quotation.
                    </label>
                  </fieldset>
                </ActionDialog>
              )}
            </div>
          )}
        </form>

        {v.spec_state === "locked" && <PostConfirmationRequest status={v.status} />}

        {v.revisions.length > 1 && (
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Specification history ({v.revisions.length} revisions)</summary>
            <ol className="mt-2 grid gap-1.5">
              {v.revisions.map((r) => (
                <li key={r.revision_number} className="tabular-nums">
                  <b>Revision {r.revision_number}</b> · {REV_LABEL[r.revision_type]} · {formatDateTime(r.created_at)}
                  {r.changes && <span className="block text-muted-foreground">{r.changes}</span>}
                  {v.approved_revision_number === r.revision_number && <span className="ml-1 font-semibold text-success">✓ confirmed by you</span>}
                </li>
              ))}
            </ol>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function PostConfirmationRequest({ status }: { status: string }) {
  const [kind, setKind] = useState<"change" | "repair">(status === "Delivered" || status === "Out for Delivery" ? "repair" : "change");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionDialog
        trigger="Request Post-Confirmation Change / Repair"
        icon={<Wrench aria-hidden />}
        size="xl"
        triggerClassName="h-auto min-h-12 w-full py-2 whitespace-normal sm:w-auto"
        variant="outline"
        title="Request a change or repair"
        description="Your confirmed specification is locked for the workshop. The shop will review your request and contact you before anything changes."
        submitLabel="Send request"
        action={(fd) => customerRepairAction(String(fd.get("description") ?? ""), kind)}
      >
        <Field label="Request type" htmlFor="kind">
          <NativeSelect id="kind" value={kind} onChange={(e) => setKind(e.target.value as "change" | "repair")}
            options={[{ value: "change", label: "Change to the confirmed specification" }, { value: "repair", label: "Touch-up / repair" }]} />
        </Field>
        <Field label="What do you need?" htmlFor="description" required>
          <TextArea id="description" name="description" required minLength={5} maxLength={1000}
            placeholder={kind === "change" ? "e.g. Could the table be 10cm longer?" : "e.g. Small scratch on the left door, about 5cm."} />
        </Field>
      </ActionDialog>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Hammer className="size-3.5" aria-hidden /> Changes after confirmation need the shop&apos;s approval.</span>
    </div>
  );
}
