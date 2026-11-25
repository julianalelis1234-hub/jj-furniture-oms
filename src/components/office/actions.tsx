"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  HandCoins,
  MailCheck,
  Hammer,
  MessageSquareReply,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  assignCraftsmanAction,
  confirmOrderAction,
  decideExceptionAction,
  rejectPaymentAction,
  verifyPaymentAction,
  editOrderAction,
  inspectionAction,
  logPaymentAction,
  moveQueueAction,
  recordConfirmationAction,
  resendReviewLinkAction,
  retryProvisioningAction,
  retrySmsAction,
  reviseSpecsAction,
  scheduleDeliveryAction,
  setInstallmentPlanAction,
  setPaymentTermsAction,
  setPriorityAction,
  startProductionAction,
  verifyHandoverAction,
} from "@/app/actions";
import { ActionButton, ActionDialog } from "@/components/action-dialog";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect, TextArea, TextInput, useServerAction } from "@/components/form";
import type { ClientOrder } from "@/lib/client-order";
import { addDays, todayISO } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { paymentGateProblem, requiredBeforeStart } from "@/lib/domain/payment-terms";
import {
  CONFIRMATION_METHODS,
  CUSTOMER_PAYMENT_METHODS,
  MUNICIPALITIES,
  PAYMENT_PLAN_LABEL,
  PAYMENT_PLANS,
  PAYMENT_EXCEPTION_TYPES,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  VEHICLE_TYPES,
  WOOD_TYPES,
  type ConfirmationMethod,
  type NotificationLog,
  type OrderException,
  type PaymentExceptionType,
  type PaymentMethod,
  type PaymentPlan,
  type PaymentType,
  type PriorityLabel,
  type Profile,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { newUuid } from "@/lib/uuid";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export function ConfirmSpecsDialog({ order }: { order: ClientOrder }) {
  // one idempotency key per dialog: a double tap or a retry can never record two acceptances
  const [key] = useState(() => newUuid());
  return (
    <ActionDialog
      trigger="Record acceptance"
      icon={<ClipboardCheck aria-hidden />}
      title={`Customer accepted ${order.order_code} · revision ${order.current_revision}?`}
      description="Record this only after the customer accepted this exact quotation (below), for example by signing it at the shop. Stale revisions, expired quotations and changed amounts are rejected by the server."
      submitLabel="Record acceptance"
      submitVariant="success"
      action={(fd) =>
        recordConfirmationAction({
          order_id: order.id,
          revision_number: order.current_revision,
          confirmation_method: s(fd, "confirmation_method") as ConfirmationMethod,
          confirmed_by_name: s(fd, "confirmed_by_name"),
          accepted_furniture_price: order.furniture_price ?? 0,
          accepted_delivery_fee: order.delivery_fee,
          client_idempotency_key: key,
          payment_plan: s(fd, "payment_plan") as PaymentPlan,
          payment_method: (s(fd, "payment_method") || null) as PaymentMethod | null,
        })
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border bg-muted p-3 text-sm">
        <dt className="text-muted-foreground">Item</dt><dd className="font-medium">{order.quantity} × {order.item_name}</dd>
        <dt className="text-muted-foreground">Design</dt><dd className="font-medium">{order.design_variant ?? "—"}</dd>
        <dt className="text-muted-foreground">Size</dt><dd className="font-medium tabular-nums">{order.dimensions}</dd>
        <dt className="text-muted-foreground">Wood</dt><dd className="font-medium">{order.wood_type}</dd>
        <dt className="text-muted-foreground">Finish</dt><dd className="font-medium">{order.color_finish}</dd>
        <dt className="text-muted-foreground">Price</dt><dd className="font-bold tabular-nums">{formatPeso(order.furniture_price)}</dd>
        <dt className="text-muted-foreground">Delivery</dt><dd className="tabular-nums">{order.delivery_fee === 0 ? "FREE" : formatPeso(order.delivery_fee)}</dd>
      </dl>
      <Field label="How did the customer accept?" htmlFor="confirmation_method" required>
        <NativeSelect id="confirmation_method" name="confirmation_method" defaultValue="Signed Paper Slip"
          options={CONFIRMATION_METHODS.filter((m) => m !== "Customer Portal PIN")} />
      </Field>
      <Field label="Confirmed by (name)" htmlFor="confirmed_by_name" required>
        <TextInput id="confirmed_by_name" name="confirmed_by_name" defaultValue={order.customer_name} required />
      </Field>
      <Field label="Payment terms" htmlFor="payment_plan" required hint="Installment needs the owner's approval before production.">
        <NativeSelect id="payment_plan" name="payment_plan" defaultValue="down_30"
          options={PAYMENT_PLANS.map((p) => ({ value: p, label: PAYMENT_PLAN_LABEL[p] }))} />
      </Field>
      <Field label="How they will pay" htmlFor="payment_method">
        <NativeSelect id="payment_method" name="payment_method" defaultValue="Cash" options={CUSTOMER_PAYMENT_METHODS} />
      </Field>
    </ActionDialog>
  );
}

/** Waiting for Confirmation -> Confirmed. The customer is then emailed to create a password (or to log in). */
/** A customer's online / bank payment: open the receipt, then verify it or reject it with a reason. */
export function VerifyPaymentControls({ paymentId, amount, reference }: { paymentId: string; amount: number; reference: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton variant="success" action={() => verifyPaymentAction(paymentId)}
        confirmText={`Confirm ${formatPeso(amount)} (ref. ${reference ?? "-"}) arrived in the shop's GCash, Maya or bank account?`}>
        <BadgeCheck aria-hidden /> Verify {formatPeso(amount)}
      </ActionButton>
      <ActionDialog trigger="Reject" icon={<XCircle aria-hidden />} variant="outline" title="Reject this payment"
        description="The customer sees your reason and can submit the payment again. A rejected payment never counts."
        submitLabel="Reject payment" submitVariant="destructive"
        action={(fd) => rejectPaymentAction(paymentId, s(fd, "reason"))}>
        <Field label="Reason" htmlFor={`rej-${paymentId}`} required>
          <TextInput id={`rej-${paymentId}`} name="reason" placeholder="e.g. Reference number not found in GCash" required maxLength={300} />
        </Field>
      </ActionDialog>
    </div>
  );
}

export function LogPaymentDialog({ order, defaultType = "Down Payment (30%)", defaultAmount }: { order: ClientOrder; defaultType?: PaymentType; defaultAmount?: number }) {
  return (
    <ActionDialog
      trigger="Log payment"
      icon={<HandCoins aria-hidden />}
      title={`Payment for ${order.order_code}`}
      description={`${order.payment_plan === "installment" ? "Installment plan, no down payment" : `${order.payment_plan === "full" ? "Full payment" : "Down payment"} due before production: ${formatPeso(requiredBeforeStart(order))}`} · Remaining balance: ${formatPeso(order.remaining_furniture_balance)}`}
      submitLabel="Save payment"
      action={(fd) => {
        fd.set("order_id", order.id);
        fd.set("client_transaction_id", newUuid()); // one key per submit: double taps can't double-log
        return logPaymentAction(null, fd);
      }}
    >
      {(errors) => (
        <>
          <Field label="Type" htmlFor="payment_type" required>
            <NativeSelect id="payment_type" name="payment_type" defaultValue={defaultType} options={PAYMENT_TYPES} />
          </Field>
          <Field label="Amount (₱)" htmlFor="amount" required error={errors.amount}>
            <TextInput id="amount" name="amount" type="number" inputMode="decimal" min="0.01" step="0.01"
              defaultValue={defaultAmount ?? ""} required invalid={!!errors.amount} />
          </Field>
          <Field label="Method" htmlFor="payment_method" required>
            <NativeSelect id="payment_method" name="payment_method" defaultValue="Cash" options={PAYMENT_METHODS} />
          </Field>
          <Field label="Notes" htmlFor="notes" hint="e.g. GCash ref no. 1234 567 890">
            <TextInput id="notes" name="notes" />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}

export function ScheduleDeliveryDialog({ order, drivers }: { order: ClientOrder; drivers: Pick<Profile, "id" | "full_name">[] }) {
  const today = todayISO();
  return (
    <ActionDialog
      trigger="Schedule delivery"
      icon={<CalendarClock aria-hidden />}
      title={`Schedule ${order.order_code}`}
      description={`${order.delivery_address}, ${order.municipality} · Collect on delivery: ${formatPeso(order.collectible_on_delivery)}`}
      submitLabel="Schedule delivery"
      action={(fd) => {
        fd.set("order_id", order.id);
        return scheduleDeliveryAction(null, fd);
      }}
    >
      {(errors) => (
        <>
          <Field label="Driver" htmlFor="driver_id" required error={errors.driver_id}>
            <NativeSelect id="driver_id" name="driver_id" defaultValue="" placeholder="Choose driver"
              options={drivers.map((d) => ({ value: d.id, label: d.full_name }))} required />
          </Field>
          <Field label="Vehicle" htmlFor="vehicle_type" required
            hint="Elf Truck for sala sets, cabinets & long-distance; Multicab for small pieces in town.">
            <NativeSelect id="vehicle_type" name="vehicle_type" defaultValue={order.municipality === "Valencia City" ? "Multicab" : "Elf Truck"} options={VEHICLE_TYPES} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor="scheduled_date" required error={errors.scheduled_date}>
              <TextInput id="scheduled_date" name="scheduled_date" type="date" min={today} defaultValue={order.scheduled_delivery_date ?? addDays(today, 1)} required />
            </Field>
            <Field label="Time window" htmlFor="time_window" required error={errors.time_window}>
              <NativeSelect id="time_window" name="time_window" defaultValue="9:00 AM - 11:00 AM"
                options={["8:00 AM - 11:00 AM", "9:00 AM - 11:00 AM", "1:00 PM - 3:00 PM", "3:00 PM - 5:00 PM"]} />
            </Field>
          </div>
        </>
      )}
    </ActionDialog>
  );
}

export function AnswerQuestionDialog({ ex, orderCode }: { ex: OrderException; orderCode: string }) {
  return (
    <ActionDialog
      trigger="Answer"
      icon={<MessageSquareReply aria-hidden />}
      title={`Spec question on ${orderCode}`}
      description={<span className="block rounded-md bg-muted p-2 text-foreground">“{ex.description}” — {ex.requested_by}</span>}
      submitLabel="Send answer to workshop"
      action={(fd) => decideExceptionAction(ex.id, "Resolved", s(fd, "note"))}
    >
      {(errors) => (
        <Field label="Answer (after checking with the customer)" htmlFor="note" required error={errors.note}>
          <TextArea id="note" name="note" required placeholder="e.g. Armrests on the 2 head chairs only — confirmed with customer by Messenger." />
        </Field>
      )}
    </ActionDialog>
  );
}

export function DecideExceptionControls({ ex, canApprove }: { ex: OrderException; canApprove: boolean }) {
  if (!canApprove) return <span className="text-sm text-muted-foreground">Waiting for owner</span>;
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog trigger="Approve" icon={<CheckCircle2 aria-hidden />} variant="success" title="Approve exception"
        description={ex.description} submitLabel="Approve" submitVariant="success"
        action={(fd) => decideExceptionAction(ex.id, "Approved", s(fd, "note"))}>
        <Field label="Terms / note (optional)" htmlFor={`a-${ex.id}`} hint="e.g. Balance in 2 payments: Dec 15 and Jan 15.">
          <TextInput id={`a-${ex.id}`} name="note" />
        </Field>
      </ActionDialog>
      <ActionDialog trigger="Reject" icon={<XCircle aria-hidden />} variant="outline" title="Reject exception"
        description={ex.description} submitLabel="Reject" submitVariant="danger"
        action={(fd) => decideExceptionAction(ex.id, "Rejected", s(fd, "note"))}>
        <Field label="Reason (optional)" htmlFor={`r-${ex.id}`}>
          <TextInput id={`r-${ex.id}`} name="note" />
        </Field>
      </ActionDialog>
    </div>
  );
}

export function ResolveRepairDialog({ ex, orderCode }: { ex: OrderException; orderCode: string }) {
  return (
    <ActionDialog trigger="Mark repaired" icon={<Wrench aria-hidden />} variant="outline" title={`Touch-up done for ${orderCode}?`}
      description={ex.description} submitLabel="Mark resolved" submitVariant="success"
      action={(fd) => decideExceptionAction(ex.id, "Resolved", s(fd, "note"))}>
      <Field label="Work done" htmlFor={`rr-${ex.id}`} hint="e.g. Painter Dodong re-stained left door; ready to reschedule.">
        <TextInput id={`rr-${ex.id}`} name="note" />
      </Field>
    </ActionDialog>
  );
}

export function VerifyHandoverButton({ paymentId, amount, driver }: { paymentId: string; amount: number; driver: string }) {
  return (
    <ActionButton variant="success" action={() => verifyHandoverAction(paymentId)}
      confirmText={`Confirm you counted ${formatPeso(amount)} handed over by ${driver}?`}>
      <BadgeCheck aria-hidden /> Verify {formatPeso(amount)}
    </ActionButton>
  );
}

export function RetrySmsDialog({ n }: { n: NotificationLog }) {
  return (
    <ActionDialog trigger="Retry SMS" icon={<RefreshCw aria-hidden />} variant="outline" title="Retry failed SMS"
      description={<span className="block rounded-md bg-muted p-2 text-foreground">{n.message_body}</span>}
      submitLabel="Send again" action={(fd) => retrySmsAction(n.id, s(fd, "phone"))}>
      <Field label="Mobile number" htmlFor={`p-${n.id}`} hint="Correct the number if the customer gave a new one.">
        <TextInput id={`p-${n.id}`} name="phone" defaultValue={n.recipient_phone ?? ""} inputMode="tel" />
      </Field>
    </ActionDialog>
  );
}

export function EditDetailsDialog({ order }: { order: ClientOrder }) {
  return (
    <ActionDialog trigger="Edit details" icon={<Pencil aria-hidden />} variant="outline" wide title={`Complete details · ${order.order_code}`}
      submitLabel="Save details" action={(fd) => editOrderAction(order.id, fd)}>
      {(errors) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer email" htmlFor="edit_customer_email" error={errors.customer_email} className="sm:col-span-2"
            hint="A new or changed email is unverified until the customer opens the review link sent to it.">
            <TextInput id="edit_customer_email" name="customer_email" type="email" defaultValue={order.customer_email ?? ""} placeholder="name@example.com" />
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="has_no_email" defaultChecked={order.has_no_email} className="size-5" /> Walk-In / No Email (Paper Slip Only)
            </label>
          </Field>
          <Field label="Mobile number" htmlFor="customer_phone" required error={errors.customer_phone}>
            <TextInput id="customer_phone" name="customer_phone" defaultValue={order.customer_phone} inputMode="tel" required />
          </Field>
          <Field label="Municipality" htmlFor="municipality" required>
            <NativeSelect id="municipality" name="municipality" defaultValue={order.municipality} options={MUNICIPALITIES} />
          </Field>
          <Field label="Delivery address" htmlFor="delivery_address" required error={errors.delivery_address} className="sm:col-span-2">
            <TextInput id="delivery_address" name="delivery_address" defaultValue={order.delivery_address} required />
          </Field>
          <Field label="Delivery fee (₱)" htmlFor="delivery_fee" hint="Automatically ₱0 for Valencia City." error={errors.delivery_fee}>
            <TextInput id="delivery_fee" name="delivery_fee" type="number" min="0" step="1" defaultValue={order.delivery_fee} />
          </Field>
          <Field label="Reference photo link" htmlFor="reference_photo_url" error={errors.reference_photo_url}>
            <TextInput id="reference_photo_url" name="reference_photo_url" type="url" defaultValue={order.reference_photo_url ?? ""} placeholder="https://…" />
          </Field>
          <Field label="Estimated completion" htmlFor="estimated_completion_date" required>
            <TextInput id="estimated_completion_date" name="estimated_completion_date" type="date" defaultValue={order.estimated_completion_date ?? ""} required />
          </Field>
          <Field label="Scheduled delivery" htmlFor="scheduled_delivery_date">
            <TextInput id="scheduled_delivery_date" name="scheduled_delivery_date" type="date" defaultValue={order.scheduled_delivery_date ?? ""} />
          </Field>
          <Field label="Special instructions" htmlFor="special_instructions" className="sm:col-span-2">
            <TextArea id="special_instructions" name="special_instructions" defaultValue={order.special_instructions ?? ""} />
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export { ReviseSpecsDialog } from "./spec-dialogs";

/** Owner/staff: number of payments (2–6, every 15 days after the 30% down payment) and the first due date. */
export function InstallmentPlanForm({ orderId, count, firstDue }: { orderId: string; count: number; firstDue: string }) {
  const { pending, run } = useServerAction();
  const [n, setN] = useState(String(count));
  const [due, setDue] = useState(firstDue);
  return (
    <form className="flex flex-wrap items-end gap-2" data-testid="installment-form"
      onSubmit={(e) => { e.preventDefault(); run(() => setInstallmentPlanAction(orderId, Number(n), due)); }}>
      <label className="grid gap-1 text-xs font-semibold">
        Payments after the down payment
        <NativeSelect value={n} onChange={(e) => setN(e.target.value)} disabled={pending} options={["2", "3", "4", "5", "6"]} name="installment_count" />
      </label>
      <label className="grid gap-1 text-xs font-semibold">
        First due date
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={pending} name="installment_first_due" required
          className="h-11 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40" />
      </label>
      <Button type="submit" disabled={pending || !due} className="h-11">{pending ? "Saving…" : "Save plan"}</Button>
      <p className="basis-full text-xs text-muted-foreground">Then one payment every 15 days. The customer sees the dates and amounts in their account.</p>
    </form>
  );
}

export function PaymentTermsSelect({ order }: { order: ClientOrder }) {
  const { pending, run } = useServerAction();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={`terms-${order.id}`} className="text-sm font-semibold">Payment terms</label>
      <NativeSelect id={`terms-${order.id}`} disabled={pending} value={order.payment_exception_type}
        onChange={(e) => run(() => setPaymentTermsAction(order.id, e.target.value as PaymentExceptionType))}
        options={PAYMENT_EXCEPTION_TYPES} />
      <p className="text-xs text-muted-foreground">
        {order.payment_exception_type === "Standard 30/70"
          ? "30% down payment before production, 70% on delivery."
          : order.payment_exception_approved
            ? "Approved by the owner."
            : "Waiting for owner approval."}
      </p>
    </div>
  );
}

export function InspectionControls({ order }: { order: ClientOrder }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog trigger="Pass" icon={<ShieldCheck aria-hidden />} variant="success" title={`Pass inspection · ${order.order_code}`}
        description={`${order.quantity} × ${order.item_name} · ${order.color_finish}`} submitLabel="Passed — ready for delivery" submitVariant="success"
        action={(fd) => inspectionAction(order.id, true, s(fd, "notes"))}>
        <Field label="Notes (optional)" htmlFor={`ip-${order.id}`}><TextInput id={`ip-${order.id}`} name="notes" /></Field>
      </ActionDialog>
      <ActionDialog trigger="Fail" icon={<XCircle aria-hidden />} variant="outline" title={`Fail inspection · ${order.order_code}`}
        description="The job goes back to the workshop under “For Revision”." submitLabel="Send back for revision" submitVariant="danger"
        action={(fd) => inspectionAction(order.id, false, s(fd, "notes"))}>
        {(errors) => (
          <Field label="What must be fixed?" htmlFor={`if-${order.id}`} required error={errors.notes}>
            <TextArea id={`if-${order.id}`} name="notes" required placeholder="e.g. Drawer rail sticks; uneven stain on left side." />
          </Field>
        )}
      </ActionDialog>
    </div>
  );
}

export function PriorityControls({ order, first, last }: { order: ClientOrder; first: boolean; last: boolean }) {
  const { pending, run } = useServerAction();
  const btn = "h-11 min-w-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={`Priority controls for ${order.order_code}`}>
      <button type="button" className={btn} disabled={pending || first} onClick={() => run(() => moveQueueAction(order.id, "up"))} aria-label="Move up">
        <ArrowUp className="mx-auto size-4" />
      </button>
      <button type="button" className={btn} disabled={pending || last} onClick={() => run(() => moveQueueAction(order.id, "down"))} aria-label="Move down">
        <ArrowDown className="mx-auto size-4" />
      </button>
      {(["Urgent", "High", "Normal"] as PriorityLabel[]).map((l) => (
        <button key={l} type="button" disabled={pending} aria-pressed={order.priority_label === l}
          onClick={() => run(() => setPriorityAction(order.id, l))}
          className={cn(btn, order.priority_label === l &&
            (l === "Urgent" ? "border-destructive bg-destructive text-destructive-foreground" : l === "High" ? "border-warning bg-warning text-warning-foreground" : "border-foreground bg-foreground text-background"))}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Confirmed -> In Production. Shows the 30% gate (verified, server-summed) and
 * the open blocking items; the server re-checks everything on submit.
 */
export function StartProductionDialog({
  order,
  verifiedPaid,
  craftsmen,
  blocking,
}: {
  order: ClientOrder;
  verifiedPaid: number;
  craftsmen: Pick<Profile, "id" | "full_name">[];
  blocking: number;
}) {
  const due = requiredBeforeStart(order);
  const ok = paymentGateProblem(order, verifiedPaid, "production") === null;
  const isInstallment = order.payment_plan === "installment";
  const need = order.payment_plan === "full" ? "Full payment" : "30% down payment";
  return (
    <ActionDialog
      trigger="Release to workshop"
      icon={<Hammer aria-hidden />}
      variant={ok && blocking === 0 ? "default" : "outline"}
      title={`Start production · ${order.order_code}`}
      description="Wood cutting starts only when the customer's payment terms are met: the verified 30% down payment, the verified full payment, or the owner's approval of an installment plan (or an owner-approved credit exception). The specification then locks for the workshop."
      submitLabel="Start production"
      submitVariant="success"
      action={(fd) => startProductionAction(order.id, s(fd, "assigned_craftsman_id") || null)}
    >
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 overflow-hidden rounded-xl border bg-background p-3 pt-0 text-sm">
        <dt className="-mx-3 mb-1 border-b bg-secondary px-3 py-1.5 text-[13px] font-bold text-foreground col-span-2">Payment gate · {order.payment_plan ? PAYMENT_PLAN_LABEL[order.payment_plan] : "30% down payment"}</dt>
        <dt className="text-muted-foreground">{isInstallment ? "Needed before production" : `${need} due`}</dt><dd className="font-semibold tabular-nums">{isInstallment ? "Owner approval" : formatPeso(due)}</dd>
        <dt className="text-muted-foreground">Verified furniture payments</dt><dd className="font-semibold tabular-nums">{formatPeso(verifiedPaid)}</dd>
        <dt className="text-muted-foreground">Gate</dt>
        <dd className={cn("font-bold", ok ? "text-success" : "text-warning")}>
          {isInstallment ? (ok ? "Installment approved ✓" : "Waiting for owner approval") : due > 0 && verifiedPaid >= due ? (order.payment_plan === "full" ? "Full payment verified ✓" : "30% verified ✓") : ok ? "Owner-approved exception ✓" : `Short ${formatPeso(due - verifiedPaid)}`}
        </dd>
        {blocking > 0 && (<><dt className="text-muted-foreground">Blocking items</dt><dd className="font-bold text-warning">{blocking} open</dd></>)}
      </dl>
      <Field label="Assign craftsman" htmlFor="assigned_craftsman_id" hint="Optional — the workshop board shows every job either way.">
        <NativeSelect id="assigned_craftsman_id" name="assigned_craftsman_id" defaultValue={order.assigned_craftsman_id ?? ""}
          options={[{ value: "", label: "Not assigned yet" }, ...craftsmen.map((c) => ({ value: c.id, label: c.full_name }))]} />
      </Field>
    </ActionDialog>
  );
}

/** Staff: issue a fresh single-use review link for the current quotation (the previous link stops working). */
export function ResendReviewLinkButton({ orderId }: { orderId: string }) {
  return (
    <ActionButton action={() => resendReviewLinkAction(orderId)} confirmText="Send a new review link to the customer's email? Any earlier link stops working.">
      <MailCheck aria-hidden /> Resend review link
    </ActionButton>
  );
}

/** Staff: retry the post-acceptance account set-up (idempotent; the acceptance itself is never touched). */
export function RetryProvisioningButton({ orderId }: { orderId: string }) {
  return (
    <ActionButton action={() => retryProvisioningAction(orderId)}>
      <RefreshCw aria-hidden /> Retry account set-up
    </ActionButton>
  );
}

/** Owner / staff: pick the craftsman for a job (recorded in the order history). */
export function AssignCraftsmanSelect({ order, craftsmen }: { order: ClientOrder; craftsmen: Pick<Profile, "id" | "full_name">[] }) {
  const { pending, run } = useServerAction();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Craftsman for {order.order_code}</span>
      <select value={order.assigned_craftsman_id ?? ""} disabled={pending} data-testid={`assign-${order.order_code}`}
        onChange={(e) => run(() => assignCraftsmanAction(order.id, e.target.value || null))}
        className="h-11 min-w-44 rounded-full border border-input bg-card px-4 pr-8 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
        <option value="">Not assigned</option>
        {craftsmen.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
      </select>
    </label>
  );
}
