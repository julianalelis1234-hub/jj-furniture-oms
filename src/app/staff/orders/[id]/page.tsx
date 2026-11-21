import { ArrowLeft, Hammer, PackageCheck, Printer, Truck } from "lucide-react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DesignNote } from "@/components/design-note";
import { LinkButton } from "@/components/link-button";
import {
  ConfirmSpecsDialog,
  DecideExceptionControls,
  EditDetailsDialog,
  InspectionControls,
  LogPaymentDialog,
  PaymentTermsSelect,
  ResolveRepairDialog,
  RetrySmsDialog,
  ReviseSpecsDialog,
  ScheduleDeliveryDialog,
  VerifyHandoverButton,
} from "@/components/office/actions";
import { TransitionButton } from "@/components/office/transition-button";
import { PriorityBadge, StageTracker, StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toClientOrder } from "@/lib/client-order";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { feePaidFrom, formatPeso, furniturePaidFrom } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { nameOf } from "@/lib/server/office-data";
import { ReviewProposalControls } from "@/components/office/spec-dialogs";
import { PreviewPanel } from "@/components/orders/preview-panel";
import { describeDiff, formatDims, type FurnitureSpec, type SpecDiff } from "@/lib/domain/furniture";
import { isCustomerProposal } from "@/lib/services/exceptions";
import type { SpecRevision } from "@/lib/domain/types";

const REVISION_LABEL: Record<SpecRevision["revision_type"], string> = {
  staff_draft: "Shop quote (draft)",
  customer_proposal: "Customer proposal",
  revised_quote: "Revised quote",
  final_approved: "Final approved",
};
const specOf = (r: Pick<SpecRevision, "furniture_category" | "design_variant" | "width_cm" | "height_cm" | "depth_cm" | "wood_type" | "custom_wood_note" | "color_finish" | "quantity">): FurnitureSpec => ({
  furniture_category: r.furniture_category, design_variant: r.design_variant, width_cm: r.width_cm, height_cm: r.height_cm,
  depth_cm: r.depth_cm, wood_type: r.wood_type, custom_wood_note: r.custom_wood_note, color_finish: r.color_finish, quantity: r.quantity,
});
import { SMS_SIMULATED_NOTE, smsMode } from "@/lib/services/notify";

export default async function OrderDetailPage({ params }: PageProps<"/staff/orders/[id]">) {
  const actor = await requireActor(["staff", "owner"]);
  const { id } = await params;
  const store = await getStore();
  const order = await store.getOrder(id);
  if (!order) notFound();
  const [revisions, profiles, payments, history, deliveries, exceptions, notifications, confirmations] = await Promise.all([
    store.listRevisions(id),
    store.listProfiles(), store.listPayments(id), store.listHistory(id), store.listDeliveries({ orderId: id }),
    store.listExceptions(id), store.listNotifications(id), store.listConfirmations(id),
  ]);
  const o = toClientOrder(order);
  const drivers = profiles.filter((p) => p.role === "driver" && p.is_active);
  const liveDelivery = deliveries.find((d) => d.dispatch_status !== "Failed / Reschedule");
  const isOwner = actor.role === "owner";
  const simulated = smsMode() === "simulated";

  return (
    <AppShell portal={isOwner ? "owner" : "staff"} actor={actor}>
      <div className="mb-3 flex flex-wrap gap-2">
        <LinkButton href={isOwner ? "/owner" : "/staff"} variant="ghost"><ArrowLeft aria-hidden /> Back</LinkButton>
        <LinkButton href={`/staff/orders/${o.id}/slip`} className="ml-auto"><Printer aria-hidden /> Print slip</LinkButton>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{o.order_code}</h1>
        <StatusBadge status={o.status} />
        <PriorityBadge label={o.priority_label} rank={o.priority_rank} />
        <span className="text-sm text-muted-foreground">Paper slip #{o.paper_slip_number} · encoded by {nameOf(profiles, o.encoded_by_id)}</span>
      </div>

      <Card className="mb-4"><CardContent className="pt-4"><StageTracker status={o.status} /></CardContent></Card>

      {/* Next step — exactly the action the current stage needs */}
      <Card className="mb-4 border-accent/60 bg-accent-soft">
        <CardHeader><CardTitle>Next step</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {o.status === "Waiting for Confirmation" && (() => {
            const latest = revisions.at(-1);
            const proposal = exceptions.find((e) => e.status === "Pending" && isCustomerProposal(e));
            const pendingOther = exceptions.some((e) => e.status === "Pending" && !isCustomerProposal(e));
            if (proposal) return <><p className="w-full text-sm font-semibold text-warning">The customer proposed changes (revision {latest?.revision_number}). Review them below and send a revised quote.</p><ReviewProposalControls ex={proposal} order={o} proposal={latest?.revision_type === "customer_proposal" ? specOf(latest) : null} /></>;
            if (o.is_legacy_incomplete) return <><p className="w-full text-sm font-semibold text-warning">Legacy order: issue a revised quote with exact W × H × D before the customer can confirm.</p><ReviseSpecsDialog order={o} /></>;
            if (pendingOther) return <><p className="w-full text-sm font-semibold text-warning">Resolve the open review item(s) below before recording the confirmation.</p><ReviseSpecsDialog order={o} /></>;
            return <><ConfirmSpecsDialog order={o} /><ReviseSpecsDialog order={o} /></>;
          })()}
          {o.status === "Confirmed" && (<>
            <TransitionButton orderId={o.id} to="In Production" version={o.version}><Hammer aria-hidden /> Start production</TransitionButton>
            <ReviseSpecsDialog order={o} />
          </>)}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
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
                <dt className="text-muted-foreground">Wood</dt><dd>{o.wood_type}{o.custom_wood_note ? ` — ${o.custom_wood_note}` : ""}</dd>
                <dt className="text-muted-foreground">Color / finish</dt><dd>{o.color_finish}</dd>
                <dt className="text-muted-foreground">Instructions</dt><dd className="whitespace-pre-line">{o.special_instructions || "—"}</dd>
                <dt className="text-muted-foreground">Reference</dt>
                <dd>{o.reference_photo_url ? <a href={o.reference_photo_url} target="_blank" rel="noreferrer noopener" className="text-primary underline">Open photo</a> : "—"}</dd>
                <dt className="text-muted-foreground">Craftsman</dt><dd>{nameOf(profiles, o.assigned_craftsman_id)}</dd>
                <dt className="text-muted-foreground">Est. completion</dt><dd className="font-semibold">{formatDate(o.estimated_completion_date)}</dd>
                <dt className="text-muted-foreground">Delivery date</dt><dd className="font-semibold">{formatDate(o.scheduled_delivery_date)}</dd>
              </dl>
              <p className="mt-3 text-sm">
                {o.specs_confirmed
                  ? <>✅ Revision {o.approved_revision_number} confirmed by customer{confirmations.at(-1) && <> · {confirmations.at(-1)!.confirmation_method} · {formatDateTime(confirmations.at(-1)!.confirmed_at)}</>}</>
                  : <span className="font-semibold text-warning">⚠ Not yet confirmed — production is blocked.</span>}
              </p>
              <details className="mt-3 rounded-lg border p-3 text-sm" open={revisions.length > 1}>
                <summary className="cursor-pointer font-semibold">Specification revisions ({revisions.length})</summary>
                <ol className="mt-2 grid gap-2">
                  {revisions.map((r) => (
                    <li key={r.id} className="tabular-nums">
                      <b>Rev. {r.revision_number}</b> · {REVISION_LABEL[r.revision_type]} · {formatPeso(r.quoted_furniture_price)}
                      {r.quoted_delivery_fee > 0 && ` + ${formatPeso(r.quoted_delivery_fee)} delivery`}
                      <span className="block text-xs text-muted-foreground">{formatDateTime(r.created_at)} · {r.created_by_id ? nameOf(profiles, r.created_by_id) : r.created_by_role}</span>
                      {"backfill" in r.changed_fields ? <span className="block text-xs text-muted-foreground">Created from the original order record</span>
                        : r.revision_number > 1 && <span className="block text-xs">{describeDiff(r.changed_fields as SpecDiff) || "No changes"}</span>}
                    </li>
                  ))}
                </ol>
              </details>
            </div>
            <PreviewPanel spec={specOf(o)} legacyDimensions={o.is_legacy_incomplete ? o.dimensions : null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Customer & delivery</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Name</dt><dd className="font-semibold">{o.customer_name}</dd>
              <dt className="text-muted-foreground">Mobile</dt><dd><a className="text-primary underline" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></dd>
              <dt className="text-muted-foreground">Address</dt><dd>{o.delivery_address}, {o.municipality}</dd>
              <dt className="text-muted-foreground">Customer PIN</dt><dd className="font-mono font-bold tracking-widest">{o.pin_code_display ?? "—"}</dd>
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
          <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
              <div className="flex justify-between"><dt>Furniture price</dt><dd className="font-semibold tabular-nums">{formatPeso(o.furniture_price)}</dd></div>
              <div className="flex justify-between"><dt>30% down payment due</dt><dd className="tabular-nums">{formatPeso(o.standard_down_payment_due)}</dd></div>
              <div className="flex justify-between"><dt>Verified furniture payments</dt><dd className="tabular-nums">− {formatPeso(furniturePaidFrom(payments))}</dd></div>
              <div className="flex justify-between"><dt>Remaining furniture balance</dt><dd className="font-semibold tabular-nums">{formatPeso(o.remaining_furniture_balance)}</dd></div>
              <div className="flex justify-between"><dt>Delivery fee {o.municipality === "Valencia City" && "(Valencia City)"}</dt><dd className="tabular-nums">{o.delivery_fee === 0 ? "FREE" : formatPeso(o.delivery_fee)}{feePaidFrom(payments) > 0 && ` (paid ${formatPeso(feePaidFrom(payments))})`}</dd></div>
              <div className="mt-1 flex justify-between border-t pt-1.5 text-base"><dt className="font-bold">Collect on delivery</dt><dd className="font-black tabular-nums">{formatPeso(o.collectible_on_delivery)}</dd></div>
            </dl>
            <PaymentTermsSelect order={o} />
            <ul className="grid gap-1.5 text-sm">
              {payments.length === 0 && <li className="text-muted-foreground">No payments yet.</li>}
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <span className="flex-1">
                    <b className="tabular-nums">{formatPeso(p.amount)}</b> · {p.payment_type} · {p.payment_method}
                    <span className="block text-xs text-muted-foreground">{formatDateTime(p.paid_at)} · {nameOf(profiles, p.collected_by_id)}{p.notes ? ` · ${p.notes}` : ""}</span>
                  </span>
                  {p.verified_by_owner_or_staff ? <span className="text-xs font-semibold text-success">Verified</span>
                    : <VerifyHandoverButton paymentId={p.id} amount={p.amount} driver={nameOf(profiles, p.collected_by_id)} />}
                </li>
              ))}
            </ul>
            {o.status !== "Delivered" || o.collectible_on_delivery > 0 ? <div><LogPaymentDialog order={o} defaultType={o.remaining_furniture_balance < o.furniture_price ? "Installment / Partial" : "Down Payment (30%)"} /></div> : null}
          </CardContent>
        </Card>

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
                          : e.category === "Spec Clarification" ? <LinkButton href="/staff">Answer in Today&apos;s Work</LinkButton>
                          : <DecideExceptionControls ex={e} canApprove={isOwner} />}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Status history</CardTitle></CardHeader>
          <CardContent>
            <ol className="grid gap-2 border-l-2 pl-4 text-sm">
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

        <Card>
          <CardHeader><CardTitle>Customer updates (SMS / Messenger)</CardTitle></CardHeader>
          <CardContent>
            <DesignNote className="mb-2">Every message is logged with its delivery result so a failed SMS becomes a visible task instead of a silent gap.</DesignNote>
            {notifications.length === 0 ? <p className="text-sm text-muted-foreground">No messages sent yet.</p> : (
              <ul className="grid gap-2 text-sm">
                {notifications.map((n) => (
                  <li key={n.id} className="rounded-lg border p-2">
                    <p className="flex flex-wrap gap-2">
                      <b className={n.delivery_status === "Failed" ? "text-destructive" : n.delivery_status === "Sent" ? "text-success" : "text-warning"}>{n.channel} · {n.delivery_status}</b>
                      {simulated && n.channel === "SMS" && <span className="text-xs font-semibold text-muted-foreground">{SMS_SIMULATED_NOTE}</span>}
                      <span className="text-xs text-muted-foreground">{formatDateTime(n.created_at)} · {n.recipient_phone}</span>
                    </p>
                    <p>{n.message_body}</p>
                    {n.delivery_status === "Failed" && <div className="mt-2"><RetrySmsDialog n={n} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
