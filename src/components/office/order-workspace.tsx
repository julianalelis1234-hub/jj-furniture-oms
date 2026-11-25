import { ExternalLink, Lock, PackageCheck, Printer, ShieldCheck, ShieldX, Truck } from "lucide-react";
import { PartsList } from "@/components/orders/parts-list";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DesignNote } from "@/components/design-note";
import { LinkButton } from "@/components/link-button";
import {
  AnswerQuestionDialog,
  ConfirmOrderButton,
  ConfirmSpecsDialog,
  DecideExceptionControls,
  EditDetailsDialog,
  InspectionControls,
  InstallmentPlanForm,
  LogPaymentDialog,
  PaymentTermsSelect,
  ResendReviewLinkButton,
  ResolveRepairDialog,
  RetryProvisioningButton,
  RetrySmsDialog,
  ReviseSpecsDialog,
  ScheduleDeliveryDialog,
  StartProductionDialog,
  VerifyHandoverButton,
  VerifyPaymentControls,
} from "@/components/office/actions";
import { ReviewProposalControls } from "@/components/office/spec-dialogs";
import { TransitionButton } from "@/components/office/transition-button";
import { WorkspaceTabs } from "@/components/office/workspace-tabs";
import { PreviewPanel } from "@/components/orders/preview-panel";
import { PriorityBadge, StageTracker, StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toClientOrder } from "@/lib/client-order";
import { addDays, formatDate, formatDateTime, todayISO } from "@/lib/domain/dates";
import { installmentSchedule } from "@/lib/domain/installments";
import { InstallmentTable } from "@/components/orders/installment-table";
import { feePaidFrom, formatPeso, furniturePaidFrom, money } from "@/lib/domain/finance";
import { describeDiff, formatDims, type FurnitureSpec, type SpecDiff } from "@/lib/domain/furniture";
import { blockingItems, isQuoteExpired, quoteValidityDays } from "@/lib/domain/gate";
import { isProductionLocked, quoteStep } from "@/lib/domain/status";
import { CONFIRMATION_METHOD_LABEL, PAYMENT_PLAN_LABEL, type Actor, type Order, type SpecRevision } from "@/lib/domain/types";
import { getStore } from "@/lib/server/context";
import { nameOf, verifierName } from "@/lib/server/office-data";
import { isCustomerProposal } from "@/lib/services/exceptions";
import { SMS_SIMULATED_NOTE, smsMode } from "@/lib/services/notify";
import { cn } from "@/lib/utils";

const REVISION_LABEL: Record<SpecRevision["revision_type"], string> = {
  staff_draft: "Shop quotation",
  customer_request: "Customer design request",
  customer_proposal: "Customer proposal",
  revised_quote: "Revised quote",
  final_approved: "Final approved",
};
export const PROVISIONING_LABEL: Record<Order["provisioning_status"], string> = {
  not_applicable: "Not applicable",
  pending: "Waiting for the shop to confirm, or for the customer to sign in",
  account_created: "Account created",
  setup_email_pending: "Password set-up email not sent yet — retry",
  setup_email_sent: "Create-password email sent; linked when they sign in",
  linked: "Linked to the customer's account",
  failed: "Account set-up failed — retry",
};
export const specOf = (r: Pick<SpecRevision, "furniture_category" | "design_variant" | "width_cm" | "height_cm" | "depth_cm" | "wood_type" | "custom_wood_note" | "color_finish" | "quantity">): FurnitureSpec => ({
  furniture_category: r.furniture_category, design_variant: r.design_variant, width_cm: r.width_cm, height_cm: r.height_cm,
  depth_cm: r.depth_cm, wood_type: r.wood_type, custom_wood_note: r.custom_wood_note, color_finish: r.color_finish, quantity: r.quantity,
});

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={cn(strong && "font-bold")}>{label}</dt>
      <dd className={cn("text-right tabular-nums", strong ? "font-black" : "font-semibold")}>{children}</dd>
    </div>
  );
}

/**
 * One order's management workspace (Staff / Owner): the same server-rendered
 * content for the slide-over drawer (3 tabs) and the full order page (stacked).
 * Every control is an existing action component, so validation, permissions and
 * audit logs are unchanged. Reads run under the signed-in actor's store (RLS).
 */
export async function OrderWorkspace({ orderId, actor, variant, initialTab }: { orderId: string; actor: Actor; variant: "drawer" | "page"; initialTab?: string }) {
  const store = await getStore();
  const order = await store.getOrder(orderId);
  if (!order) notFound();
  const [revisions, profiles, payments, history, deliveries, exceptions, notifications, confirmations] = await Promise.all([
    store.listRevisions(orderId),
    store.listProfiles(), store.listPayments(orderId), store.listHistory(orderId), store.listDeliveries({ orderId }),
    store.listExceptions(orderId), store.listNotifications(orderId), store.listConfirmations(orderId),
  ]);
  const o = toClientOrder(order);
  const isOwner = actor.role === "owner";
  const drivers = profiles.filter((p) => p.role === "driver" && p.is_active);
  const craftsmen = profiles.filter((p) => p.role === "craftsman" && p.is_active);
  const liveDelivery = deliveries.find((d) => d.dispatch_status !== "Failed / Reschedule");
  const validityDays = quoteValidityDays();
  const simulated = smsMode() === "simulated";
  // money: VERIFIED furniture payments are the only ones that count (30% gate, balances)
  const verifiedPaid = furniturePaidFrom(payments);
  const verified = payments.filter((p) => p.verified_by_owner_or_staff);
  const unverified = payments.filter((p) => !p.verified_by_owner_or_staff && !p.rejected_at);
  const rejected = payments.filter((p) => !!p.rejected_at);
  const unverifiedSum = money(unverified.reduce((s, p) => s + Number(p.amount), 0));
  const step = quoteStep(o);
  const down = o.standard_down_payment_due;
  const exceptionOk = o.payment_exception_type !== "Standard 30/70" && o.payment_exception_approved;
  const gateMet = o.furniture_price != null && (verifiedPaid >= down || exceptionOk);
  const pct = o.furniture_price ? Math.round((verifiedPaid / o.furniture_price) * 100) : 0;

  // ------------------------------------------------------------ next step ----
  const nextStep = (
    <Card className="border-live/60 bg-accent-soft" data-testid="next-step">
      <CardHeader><CardTitle>Next step</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {o.status === "Quote Requested" && (<>
          <p className="w-full text-sm">
            <b>Customer design request (Option 2) — intake, before the 7 stages.</b> Check size, wood and finish, then issue the official quotation
            with price, delivery fee and paper slip number. Craftsmen do not see this order yet.
          </p>
          <ReviseSpecsDialog order={o} validityDays={validityDays} />
          <EditDetailsDialog order={o} />
        </>)}
        {o.status === "Waiting for Confirmation" && (() => {
          const latest = revisions.at(-1);
          const proposal = exceptions.find((e) => e.status === "Pending" && isCustomerProposal(e));
          if (proposal) return <><p className="w-full text-sm font-semibold text-warning">The customer proposed changes (revision {latest?.revision_number}). Review them first.</p><ReviewProposalControls ex={proposal} order={o} proposal={latest?.revision_type === "customer_proposal" ? specOf(latest) : null} /></>;
          if (blockingItems(o.id, exceptions).length > 0) return <p className="w-full text-sm font-semibold text-warning">Resolve the open production-blocking item(s) before confirming this order.</p>;
          return <>
            <p className="w-full text-sm">
              <b>{o.order_origin === "customer_self_service" ? "New online order." : "New order."}</b> Check the design, size, wood and finish, then confirm it.
              {o.customer_email ? " The customer is emailed a link to create their password; the quotation comes next." : " Walk-in: no email is sent."}
            </p>
            <ConfirmOrderButton order={o} />
            <EditDetailsDialog order={o} />
          </>;
        })()}
        {o.status === "Confirmed" && (() => {
          const latest = revisions.at(-1);
          const proposal = exceptions.find((e) => e.status === "Pending" && isCustomerProposal(e));
          if (proposal) return <><p className="w-full text-sm font-semibold text-warning">The customer proposed changes (revision {latest?.revision_number}). Review them and re-issue the quotation.</p><ReviewProposalControls ex={proposal} order={o} proposal={latest?.revision_type === "customer_proposal" ? specOf(latest) : null} /></>;
          if (step === "awaiting_quotation") return <>
            <p className="w-full text-sm"><b>Confirmed — issue the official quotation.</b> Set the final price, delivery fee and completion date. The customer is emailed to accept it and choose how to pay.</p>
            <ReviseSpecsDialog order={o} validityDays={validityDays} label="Issue quotation" />
          </>;
          if (step === "awaiting_acceptance") {
            if (latest && isQuoteExpired(latest)) return <><p className="w-full text-sm font-semibold text-warning">The quotation (revision {latest.revision_number}) expired on {formatDateTime(latest.expires_at!)}. Issue a fresh one.</p><ReviseSpecsDialog order={o} validityDays={validityDays} label="Issue fresh quotation" /></>;
            return <>
              <p className="w-full text-sm">Quotation issued{latest?.expires_at && <>, valid until <b>{formatDateTime(latest.expires_at)}</b></>}. Waiting for the customer to accept it and choose 30% down payment, installment or full payment.</p>
              <ConfirmSpecsDialog order={o} />
              <ReviseSpecsDialog order={o} validityDays={validityDays} label="Re-issue quotation" />
            </>;
          }
          return <>
            <p className="w-full text-sm">
              Quotation accepted{o.payment_plan && <> · <b>{PAYMENT_PLAN_LABEL[o.payment_plan]}</b>{o.preferred_payment_method && `, ${o.preferred_payment_method}`}</>}. <b>Not yet authorized to cut wood:</b> release to the workshop
              after the 30% down payment ({formatPeso(down)}) is verified. {formatPeso(verifiedPaid)} verified so far{unverifiedSum > 0 && <> (+ {formatPeso(unverifiedSum)} waiting for verification)</>}.
            </p>
            <StartProductionDialog order={o} verifiedPaid={verifiedPaid} blocking={blockingItems(o.id, exceptions).length} craftsmen={craftsmen} />
            <LogPaymentDialog order={o} defaultAmount={Math.max(0, down - verifiedPaid) || undefined} />
          </>;
        })()}
        {o.status === "In Production" && (
          <TransitionButton orderId={o.id} to="Completed / For Inspection" version={o.version}><PackageCheck aria-hidden /> Mark ready for inspection</TransitionButton>
        )}
        {o.status === "Completed / For Inspection" && (isOwner ? <InspectionControls order={o} /> : <p className="text-sm">Waiting for the owner&apos;s quality inspection.</p>)}
        {o.status === "Ready for Delivery" && (liveDelivery
          ? <p className="text-sm">Scheduled {formatDate(liveDelivery.scheduled_date)} · {liveDelivery.time_window} · {nameOf(profiles, liveDelivery.driver_id)} ({liveDelivery.vehicle_type})</p>
          : <ScheduleDeliveryDialog order={o} drivers={drivers} />)}
        {o.status === "Out for Delivery" && (
          <TransitionButton orderId={o.id} to="Delivered" version={o.version} variant="success"
            confirmText="Mark as delivered from the office (e.g. customer picked up)? Drivers normally record this from their phone.">
            <Truck aria-hidden /> Mark delivered (office)
          </TransitionButton>
        )}
        {o.status === "Delivered" && <p className="text-sm">Order complete. {o.collectible_on_delivery > 0 && <b>Unpaid balance: {formatPeso(o.collectible_on_delivery)}</b>}</p>}
      </CardContent>
    </Card>
  );

  // ---------------------------------------------------- 1. overview & 3D spec ----
  const overview = (
    <div className="grid gap-4">
      <Card><CardContent className="pt-4"><StageTracker status={o.status} /></CardContent></Card>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-2">
          <CardTitle>Specifications</CardTitle>
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
            Revision {o.current_revision ?? "—"}{o.approved_revision_number ? ` · confirmed rev. ${o.approved_revision_number}` : ""}
          </span>
          {o.is_legacy_incomplete && <span className="rounded-full border border-warning/50 bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Legacy record — dimensions pending clarification</span>}
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
          <div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Item</dt><dd className="font-semibold">{o.quantity} × {o.item_name}</dd>
              <dt className="text-muted-foreground">Category</dt><dd>{o.furniture_category ?? "—"}{o.design_variant ? ` · ${o.design_variant}` : ""}</dd>
              <dt className="text-muted-foreground">W × H × D</dt><dd className="font-semibold tabular-nums">{formatDims(o) ?? <span className="text-warning">Dimensions Pending Clarification ({o.dimensions})</span>}</dd>
              <dt className="text-muted-foreground">Wood</dt><dd>{o.wood_type === "Other" && o.custom_wood_note ? o.custom_wood_note : o.wood_type}{o.wood_type !== "Other" && o.custom_wood_note ? ` — ${o.custom_wood_note}` : ""}</dd>
              <dt className="text-muted-foreground">Color / finish</dt><dd>{o.color_finish}</dd>
              <dt className="text-muted-foreground">Delivery notes</dt><dd className="whitespace-pre-line">{o.special_instructions || "—"}</dd>
              <dt className="text-muted-foreground">Reference</dt>
              <dd>{o.reference_photo_url ? <a href={o.reference_photo_url} target="_blank" rel="noreferrer noopener" className="text-primary underline">Open photo</a> : "—"}</dd>
              <dt className="text-muted-foreground">Room photo</dt>
              <dd>{o.room_photo_path ? <a href={`/api/orders/${o.id}/room-photo`} target="_blank" rel="noreferrer noopener" className="text-primary underline" data-testid="room-photo-link">Open the customer&apos;s room photo</a> : "—"}</dd>
              <dt className="text-muted-foreground">Craftsman</dt><dd>{nameOf(profiles, o.assigned_craftsman_id)}</dd>
              <dt className="text-muted-foreground">Est. completion</dt><dd className="font-semibold">{formatDate(o.estimated_completion_date)}</dd>
              <dt className="text-muted-foreground">Delivery date</dt><dd className="font-semibold">{formatDate(o.scheduled_delivery_date)}</dd>
            </dl>
            <p className="mt-3 text-sm">
              {o.specs_confirmed
                ? <>✅ Quotation (revision {o.approved_revision_number}) accepted by the customer{confirmations.at(-1) && <> · {CONFIRMATION_METHOD_LABEL[confirmations.at(-1)!.confirmation_method]} · {formatDateTime(confirmations.at(-1)!.confirmed_at)}</>}</>
                : <span className="font-semibold text-warning">⚠ Quotation not accepted yet — production is blocked.</span>}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Turning or zooming the preview never changes the specification; changes go through a new revision.</p>
            <PartsList className="mt-3" quantity={o.quantity} woodLabel={o.wood_type === "Other" && o.custom_wood_note ? o.custom_wood_note : o.wood_type}
              spec={{ furniture_category: o.furniture_category, design_variant: o.design_variant, width_cm: o.width_cm, height_cm: o.height_cm, depth_cm: o.depth_cm }} />
          </div>
          {/* the one 3D renderer (Furniture3DPreview via PreviewPanel); view-only */}
          <PreviewPanel spec={specOf(o)} legacyDimensions={o.is_legacy_incomplete ? o.dimensions : null} />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Customer & delivery</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Name</dt><dd className="font-semibold">{o.customer_name}</dd>
              <dt className="text-muted-foreground">Mobile</dt><dd><a className="text-primary underline" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></dd>
              <dt className="text-muted-foreground">Address</dt><dd>{o.delivery_address}, {o.municipality}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd data-testid="customer-email-status">
                {o.has_no_email ? "Walk-in · paper slip only (no portal, no email)"
                  : o.customer_email ? <>{o.customer_email} · {o.email_verified_at ? <span className="font-semibold text-success">verified {formatDateTime(o.email_verified_at)}</span> : <span className="text-warning">unverified</span>}</>
                  : "— (recorded before emails were collected)"}
              </dd>
              {o.customer_email && <><dt className="text-muted-foreground">Account</dt><dd>{PROVISIONING_LABEL[o.provisioning_status]}</dd></>}
            </dl>
            {deliveries.length > 0 && (
              <ul className="grid gap-1.5 text-sm">
                {deliveries.map((d) => (
                  <li key={d.id} className="rounded-lg bg-muted p-2">
                    <b>{d.dispatch_status}</b> · {formatDate(d.scheduled_date)} {d.time_window} · {nameOf(profiles, d.driver_id)} · {d.vehicle_type}
                    {d.failure_or_damage_notes && <p className="text-muted-foreground">{d.failure_or_damage_notes}</p>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2"><EditDetailsDialog order={o} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Status history</CardTitle></CardHeader>
          <CardContent>
            <ol className="grid gap-2 border-l-2 border-stage-track pl-4 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <p><b>{h.to_status}</b>{h.from_status && h.from_status !== h.to_status && <span className="text-muted-foreground"> from {h.from_status}</span>}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(h.changed_at)} · {nameOf(profiles, h.changed_by_id)}{h.client_transaction_id && " · synced from phone"}</p>
                  {h.notes && <p className="text-muted-foreground">{h.notes}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Approvals, questions & repairs</CardTitle></CardHeader>
        <CardContent>
          {exceptions.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="grid gap-2">
              {exceptions.map((e) => (
                <li key={e.id} className="rounded-lg border p-2 text-sm">
                  <p><b>{e.category}</b> · <span className={e.status === "Pending" ? "font-semibold text-warning" : "text-muted-foreground"}>{e.status}</span></p>
                  <p className="whitespace-pre-line">{e.description}</p>
                  <p className="text-xs text-muted-foreground">{e.requested_by} · {formatDateTime(e.created_at)}</p>
                  {e.status === "Pending" && (
                    <div className="mt-2">
                      {e.category === "On-Site Scratch Touch-Up / Repair" ? <ResolveRepairDialog ex={e} orderCode={o.order_code} />
                        : isCustomerProposal(e) ? <ReviewProposalControls ex={e} order={o} proposal={revisions.at(-1)?.revision_type === "customer_proposal" ? specOf(revisions.at(-1)!) : null} />
                        : e.category === "Spec Clarification" ? <AnswerQuestionDialog ex={e} orderCode={o.order_code} />
                        : <DecideExceptionControls ex={e} canApprove={isOwner} />}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // ------------------------------------------------ 2. quotation & revisions ----
  const quotation = (
    <div className="grid gap-4">
      <Card className="gap-0 py-0">
        <CardHeader className="border-b bg-secondary py-3"><CardTitle>Quotation</CardTitle></CardHeader>
        <CardContent className="grid gap-3 bg-background py-4">
          <dl className="grid gap-1 text-sm">
            <Row label="Quotation">{o.quotation_issued_at ? `Issued ${formatDateTime(o.quotation_issued_at)}` : o.status === "Confirmed" ? "Not issued yet" : "After confirmation"}</Row>
            <Row label="Payment terms">{o.payment_plan ? `${PAYMENT_PLAN_LABEL[o.payment_plan]}${o.preferred_payment_method ? ` · ${o.preferred_payment_method}` : ""}` : "Chosen when the customer accepts"}</Row>
            <Row label="Furniture price">{o.furniture_price == null ? "Pending quotation" : formatPeso(o.furniture_price)}</Row>
            <Row label={`Delivery fee (separate)${o.municipality === "Valencia City" ? " · Valencia City" : ""}`}>{o.delivery_fee === 0 ? "FREE" : formatPeso(o.delivery_fee)}</Row>
            <Row label="30% down payment">{o.furniture_price == null ? "—" : formatPeso(down)}</Row>
          </dl>
          <div className="flex flex-wrap gap-2">
            {o.status === "Waiting for Confirmation" && <ConfirmOrderButton order={o} />}
            {(o.status === "Quote Requested" || o.status === "Waiting for Confirmation" || o.status === "Confirmed") &&
              <ReviseSpecsDialog order={o} validityDays={validityDays} label={step === "awaiting_quotation" ? "Issue quotation" : o.status === "Confirmed" ? "Re-issue quotation" : "Edit draft quote"} />}
            {step === "awaiting_acceptance" && !o.is_legacy_incomplete && <ConfirmSpecsDialog order={o} />}
            {o.customer_email && step === "awaiting_acceptance" && <ResendReviewLinkButton orderId={o.id} />}
            {o.customer_email && o.status !== "Waiting for Confirmation" && o.status !== "Quote Requested" && ["pending", "failed", "setup_email_pending", "account_created"].includes(o.provisioning_status) && <RetryProvisioningButton orderId={o.id} />}
          </div>
          {!o.customer_email && <p className="text-xs text-muted-foreground">Walk-in / no email: quotations are confirmed on the paper slip or by Messenger.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Specification revisions ({revisions.length})</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm">
            {revisions.map((r) => (
              <li key={r.revision_id} className={cn("rounded-lg border p-2 tabular-nums", r.revision_number === o.approved_revision_number && "border-success/60 bg-success-soft")}>
                <b>Rev. {r.revision_number}</b> · {REVISION_LABEL[r.revision_type]}
                {r.quoted_furniture_price != null && <> · {formatPeso(r.quoted_furniture_price)}</>}
                {(r.quoted_delivery_fee ?? 0) > 0 && ` + ${formatPeso(r.quoted_delivery_fee)} delivery`}
                {r.revision_number === o.approved_revision_number && <span className="ml-1 font-semibold text-success">· accepted</span>}
                {r.expires_at && <span className="block text-xs text-muted-foreground">Quoted {formatDateTime(r.quoted_at!)} · valid until {formatDateTime(r.expires_at)}{isQuoteExpired(r) ? " (expired)" : ""}</span>}
                <span className="block text-xs text-muted-foreground">{formatDateTime(r.created_at)} · {r.created_by_id ? nameOf(profiles, r.created_by_id) : r.created_by_role}</span>
                {"backfill" in r.changed_fields ? <span className="block text-xs text-muted-foreground">Created from the original order record</span>
                  : r.revision_number > 1 && <span className="block text-xs">Changes vs. rev. {r.revision_number - 1}: {describeDiff(r.changed_fields as SpecDiff) || "No changes"}</span>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Customer notifications</CardTitle></CardHeader>
        <CardContent>
          {notifications.length === 0 ? <p className="text-sm text-muted-foreground">No messages sent yet.</p> : (
            <ul className="grid gap-2 text-sm">
              {notifications.map((n) => (
                <li key={n.id} className="rounded-lg border p-2">
                  <p className="flex flex-wrap gap-2">
                    <b className={n.delivery_status === "Failed" ? "text-destructive" : n.delivery_status === "Sent" ? "text-success" : "text-warning"}>{n.channel} · {n.delivery_status}</b>
                    {simulated && n.channel === "SMS" && <span className="text-xs font-semibold text-muted-foreground">{SMS_SIMULATED_NOTE}</span>}
                    <span className="text-xs text-muted-foreground">{formatDateTime(n.created_at)} · {n.recipient_phone ?? n.recipient_email}</span>
                  </p>
                  <p className="whitespace-pre-line">{n.message_body}</p>
                  {n.delivery_status === "Failed" && n.channel !== "Email" && <div className="mt-2"><RetrySmsDialog n={n} /></div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // ------------------------------------------- 3. payments & production gate ----
  const schedule = installmentSchedule(o, verifiedPaid, todayISO());
  const payment = (
    <div className="grid gap-4">
      <Card className="gap-0 py-0" data-testid="production-gate">
        <CardHeader className="border-b bg-secondary py-3"><CardTitle>Payments & 30% production gate</CardTitle></CardHeader>
        <CardContent className="grid gap-3 bg-background py-4">
          <dl className="grid gap-1 text-sm">
            <Row label="Furniture price">{o.furniture_price == null ? "Pending quotation" : formatPeso(o.furniture_price)}</Row>
            <Row label="Required 30% down payment">{o.furniture_price == null ? "—" : formatPeso(down)}</Row>
            <Row label={`Verified furniture payments${o.furniture_price ? ` (${pct}%)` : ""}`}>{formatPeso(verifiedPaid)}</Row>
            <Row label="Unverified submissions (not counted)">{formatPeso(unverifiedSum)}</Row>
            <Row label="Remaining furniture balance">{formatPeso(o.remaining_furniture_balance)}</Row>
            <Row label="Delivery fee (separate)">{o.delivery_fee === 0 ? "FREE" : <>{formatPeso(o.delivery_fee)}{feePaidFrom(payments) > 0 && ` · paid ${formatPeso(feePaidFrom(payments))}`}</>}</Row>
            <div className="mt-1 border-t pt-1.5"><Row label="Collect on delivery" strong>{formatPeso(o.collectible_on_delivery)}</Row></div>
          </dl>
          <p className={cn("flex items-center gap-2 rounded-xl border p-2.5 text-sm font-semibold", gateMet ? "border-success/50 bg-success-soft text-success" : "border-warning/50 bg-warning-soft text-warning")} data-testid="gate-status">
            {gateMet ? <ShieldCheck className="size-5 shrink-0" aria-hidden /> : <ShieldX className="size-5 shrink-0" aria-hidden />}
            {o.furniture_price == null ? "No quotation yet — nothing to collect."
              : verifiedPaid >= down ? "30% down payment verified — the production gate is met."
              : exceptionOk ? "Owner-approved payment exception — the production gate is met."
              : `Production gate NOT met: ${formatPeso(money(down - verifiedPaid))} more verified payment needed. Unverified submissions never count.`}
          </p>
          {o.status === "Confirmed" && <StartProductionDialog order={o} verifiedPaid={verifiedPaid} blocking={blockingItems(o.id, exceptions).length} craftsmen={craftsmen} />}
          <PaymentTermsSelect order={o} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Unverified submissions ({unverified.length})</CardTitle></CardHeader>
        <CardContent>
          {unverified.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting for verification.</p> : (
            <ul className="grid gap-1.5 text-sm">
              {unverified.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 p-2" data-testid="unverified-payment">
                  <span className="min-w-0 flex-1"><b className="tabular-nums">{formatPeso(p.amount)}</b> · {p.payment_type} · {p.payment_method}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(p.paid_at)} · {p.submitted_by ? <>submitted by the customer · ref. <b className="text-foreground">{p.reference_number}</b></> : nameOf(profiles, p.collected_by_id)}{p.notes ? ` · ${p.notes}` : ""}
                    </span>
                    {p.proof_path && <a href={`/api/payments/${p.id}/proof`} target="_blank" rel="noreferrer noopener" className="text-xs font-semibold text-primary underline">Open receipt</a>}
                  </span>
                  {p.submitted_by
                    ? <VerifyPaymentControls paymentId={p.id} amount={p.amount} reference={p.reference_number ?? null} />
                    : <VerifyHandoverButton paymentId={p.id} amount={p.amount} driver={nameOf(profiles, p.collected_by_id)} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {rejected.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Rejected submissions ({rejected.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm">
              {rejected.map((p) => (
                <li key={p.id} className="rounded-lg border p-2">
                  <b className="tabular-nums">{formatPeso(p.amount)}</b> · {p.payment_method} · ref. {p.reference_number ?? "-"}
                  <span className="block text-xs text-muted-foreground">Rejected {formatDateTime(p.rejected_at!)} by {nameOf(profiles, p.rejected_by_id ?? null)}: {p.rejection_reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {o.payment_plan === "installment" && (
        <Card data-testid="installment-plan">
          <CardHeader><CardTitle>Installment plan</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {schedule ? (
              <>
                <InstallmentTable rows={schedule} />
                <p className="text-xs text-muted-foreground">
                  Set by {nameOf(profiles, o.installment_set_by ?? null)}{o.installment_set_at ? ` · ${formatDateTime(o.installment_set_at)}` : ""}. Verified payments are applied in order, down payment first.
                </p>
              </>
            ) : (
              <p className="rounded-xl border border-warning/50 bg-warning-soft p-2.5 text-sm font-semibold text-warning">
                The customer chose installment payments. Set the number of payments and the first due date.
              </p>
            )}
            {o.furniture_price != null && o.status !== "Delivered" && (
              <InstallmentPlanForm orderId={o.id} count={o.installment_count ?? 3} firstDue={o.installment_first_due ?? addDays(todayISO(), 15)} />
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Verified payments ({verified.length})</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {verified.length === 0 ? <p className="text-sm text-muted-foreground">No verified payments yet.</p> : (
            <ul className="grid gap-1.5 text-sm">
              {verified.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <span className="flex-1"><b className="tabular-nums">{formatPeso(p.amount)}</b> · {p.payment_type} · {p.payment_method}
                    <span className="block text-xs text-muted-foreground">{formatDateTime(p.paid_at)} · {p.submitted_by ? "submitted by the customer" : nameOf(profiles, p.collected_by_id)}{p.notes ? ` · ${p.notes}` : ""}</span></span>
                  <span className="text-right text-xs font-semibold text-success" data-testid="verified-by">
                    Verified by {verifierName(p, profiles)}
                    {p.verified_at && <span className="block font-normal text-muted-foreground">{formatDateTime(p.verified_at)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {o.furniture_price != null && (o.status !== "Delivered" || o.collectible_on_delivery > 0) &&
            <div><LogPaymentDialog order={o} defaultType={o.remaining_furniture_balance < (o.furniture_price ?? 0) ? "Installment / Partial" : "Down Payment (30%)"} /></div>}
        </CardContent>
      </Card>
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      {variant === "page" ? <h1 className="text-2xl font-bold sm:text-3xl">{o.order_code}</h1> : <h2 id="drawer-title" className="text-2xl font-bold">{o.order_code}</h2>}
      <StatusBadge status={o.status} />
      <PriorityBadge label={o.priority_label} rank={o.priority_rank} />
      {isProductionLocked(o.status) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-0.5 text-xs font-bold text-background" data-testid="spec-locked">
          <Lock className="size-3" aria-hidden /> Spec locked
        </span>
      )}
      <span className="w-full text-sm text-muted-foreground">
        {o.customer_name} · {o.order_origin === "customer_self_service" ? <>Online order · order slip {o.paper_slip_number ?? o.order_code}</> : o.paper_slip_number ? <>Paper slip #{o.paper_slip_number} · encoded by {nameOf(profiles, o.encoded_by_id)}</> : <>No paper slip yet</>}
      </span>
      <div className="flex w-full flex-wrap gap-2">
        {o.paper_slip_number && o.furniture_price != null && <LinkButton href={`/staff/orders/${o.id}/slip`} size="sm"><Printer aria-hidden /> Print slip</LinkButton>}
        {variant === "drawer" && <LinkButton href={`/staff/orders/${o.id}`} size="sm" variant="ghost"><ExternalLink aria-hidden /> Full page</LinkButton>}
      </div>
    </div>
  );

  if (variant === "drawer")
    return (
      <div className="grid gap-4">
        {header}
        {nextStep}
        <WorkspaceTabs initial={initialTab} panels={{ overview, quotation, payments: payment }} />
      </div>
    );
  return (
    <div className="grid gap-6">
      {header}
      {nextStep}
      <section aria-labelledby="ws-overview" className="grid gap-3"><h2 id="ws-overview" className="text-xl font-semibold">Overview &amp; 3D spec</h2>{overview}</section>
      <section aria-labelledby="ws-quote" className="grid gap-3"><h2 id="ws-quote" className="text-xl font-semibold">Quotation &amp; revisions</h2>{quotation}</section>
      <section aria-labelledby="ws-pay" className="grid gap-3"><h2 id="ws-pay" className="text-xl font-semibold">Payments &amp; production gate</h2>{payment}</section>
      <DesignNote>Every control here calls the same server actions as before; permissions, validation and the audit trail are unchanged.</DesignNote>
    </div>
  );
}
