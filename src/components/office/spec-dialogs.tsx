"use client";

import { FileSignature, Loader2, PencilRuler, Undo2 } from "lucide-react";
import { addDays, todayISO } from "@/lib/domain/dates";
import { useState } from "react";
import { reviewProposalAction, reviseSpecsAction } from "@/app/actions";
import { ActionButton } from "@/components/action-dialog";
import { Field, TextInput, useServerAction } from "@/components/form";
import { configFromSpec, emptyConfig, FurnitureConfigurator, type ConfigValue } from "@/components/orders/FurnitureConfigurator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ClientOrder } from "@/lib/client-order";
import { formatPeso } from "@/lib/domain/finance";
import type { FurnitureSpec } from "@/lib/domain/furniture";
import type { OrderException } from "@/lib/domain/types";

function orderSpec(o: ClientOrder): FurnitureSpec {
  return {
    furniture_category: o.furniture_category, design_variant: o.design_variant, width_cm: o.width_cm, height_cm: o.height_cm,
    depth_cm: o.depth_cm, wood_type: o.wood_type, custom_wood_note: o.custom_wood_note, color_finish: o.color_finish, quantity: o.quantity,
  };
}
function startConfig(spec: FurnitureSpec): ConfigValue {
  const c = configFromSpec(spec);
  if (!c.furniture_category) return { ...emptyConfig(), wood_type: c.wood_type, quantity: c.quantity };
  if (!c.color_finish?.trim()) c.color_finish = "Natural Varnish"; // an existing custom finish is kept as ordered
  return c;
}

/** Configurator + price/fee in a dialog: issues a new revised-quote revision. */
function QuoteEditor({
  open, onOpenChange, title, description, order, spec, submitLabel, onSubmit, extra, validityDays, locked = false,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; order: ClientOrder; spec: FurnitureSpec;
  submitLabel: string; onSubmit: (fd: FormData) => ReturnType<typeof reviseSpecsAction>; extra?: React.ReactNode; validityDays: number;
  /** the customer's design: shown read-only, only the price and fee are set */
  locked?: boolean;
}) {
  const [config, setConfig] = useState<ConfigValue>(() => startConfig(spec));
  const { pending, run, errors } = useServerAction();
  const valencia = order.municipality === "Valencia City";
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => onSubmit(fd), () => onOpenChange(false));
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <FurnitureConfigurator value={config} onChange={setConfig} errors={errors} showQuantity inDialog readOnly={locked}
            lockedLabel={locked ? "The customer's design — the quotation sets the price only. Ask the customer to propose any change." : undefined} />
          {/* read-only inputs are not submitted, so the design travels as hidden fields */}
          {locked && (["furniture_category", "design_variant", "width_cm", "height_cm", "depth_cm", "wood_type", "custom_wood_note", "color_finish", "quantity"] as const).map((k) => (
            <input key={k} type="hidden" name={k} value={config[k]} />
          ))}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Furniture price (₱)" htmlFor="q-price" required error={errors.furniture_price}>
              <TextInput id="q-price" name="furniture_price" type="number" min="1" step="0.01" defaultValue={order.furniture_price ?? ""} required className="tabular-nums" />
            </Field>
            <Field label="Delivery fee (₱)" htmlFor="q-fee" error={errors.delivery_fee} hint={valencia ? "Valencia City: always FREE." : `${order.municipality}: distance fee.`}>
              <TextInput id="q-fee" name="delivery_fee" type="number" min="0" step="1" defaultValue={valencia ? 0 : order.delivery_fee} readOnly={valencia} className="tabular-nums" />
            </Field>
            {!order.paper_slip_number && (
              <Field label="Paper Slip #" htmlFor="q-slip" required error={errors.paper_slip_number} hint="Write the official slip for this request, then enter its number.">
                <TextInput id="q-slip" name="paper_slip_number" inputMode="numeric" required />
              </Field>
            )}
            {!order.estimated_completion_date && (
              <Field label="Estimated completion" htmlFor="q-est" required error={errors.estimated_completion_date}>
                <TextInput id="q-est" name="estimated_completion_date" type="date" min={todayISO()} defaultValue={addDays(todayISO(), 14)} required />
              </Field>
            )}
            {extra}
          </div>
          <p className="text-xs text-muted-foreground">
            The quotation is valid for {validityDays} days. The customer must accept the exact specification and amounts before it expires.
          </p>
          {errors._form && <p className="text-sm text-destructive">{errors._form}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" size="touch" variant="warning" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Staff/owner: save a shop revision (migration 009 meanings):
 *  - Confirmed, no quotation yet -> the official quotation (customer is emailed to accept + pay)
 *  - Confirmed, quotation issued -> a re-issued quotation (voids an earlier acceptance)
 *  - Waiting for Confirmation    -> a draft quote before the order is confirmed (no email)
 *  - legacy Quote Requested      -> the first quotation of an old request
 */
export function ReviseSpecsDialog({ order, validityDays = 7, label }: { order: ClientOrder; validityDays?: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const issuing = (order.status === "Confirmed" && !order.quotation_issued_at) || order.status === "Quote Requested";
  const reissue = order.status === "Confirmed" && !!order.quotation_issued_at;
  const n = order.current_revision + 1;
  // an online order is designed by the customer: the shop prices it, it does not change it
  const locked = order.order_origin === "customer_self_service" && !!order.furniture_category;
  const copy = issuing
    ? { title: `Official quotation · ${order.order_code}`, submit: "Issue quotation",
        description: `${locked ? "This is the customer's design. Set the price and delivery fee" : "Check size, wood and finish, adjust if needed, then set the price and delivery fee"}. Saved as revision ${n}. The customer is emailed to accept it and choose 30% down payment, installment or full payment.` }
    : reissue
      ? { title: `Re-issue quotation · ${order.order_code}`, submit: "Re-issue quotation",
          description: `Saved as revision ${n}. It replaces the current quotation and voids any acceptance; the customer is emailed to accept the new one.` }
      : { title: `Draft quote · ${order.order_code}`, submit: "Save draft quote",
          description: `Saved as revision ${n}. Nothing is emailed yet: confirm the order, then issue the official quotation.` };
  return (
    <>
      <Button variant={issuing ? "default" : "outline"} size="touch" onClick={() => setOpen(true)}>
        {issuing ? <FileSignature aria-hidden /> : <PencilRuler aria-hidden />} {label ?? (issuing ? "Issue quotation" : reissue ? "Re-issue quotation" : "Edit draft quote")}
      </Button>
      {open && (
        <QuoteEditor
          open={open} onOpenChange={setOpen} order={order} spec={orderSpec(order)} validityDays={validityDays} locked={locked}
          title={copy.title} description={copy.description} submitLabel={copy.submit}
          onSubmit={(fd) => reviseSpecsAction(order.id, order.current_revision, fd)}
        />
      )}
    </>
  );
}

/** Staff/owner: review a customer's proposed changes. */
export function ReviewProposalControls({ ex, order, proposal }: { ex: OrderException; order: ClientOrder; proposal: FurnitureSpec | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="touch" onClick={() => setOpen(true)} disabled={!proposal}><PencilRuler aria-hidden /> Review &amp; send revised quote</Button>
      <ActionButton
        variant="outline"
        confirmText="Keep the original specification and ask the customer to confirm it again?"
        action={() => {
          const fd = new FormData();
          fd.set("note", "Proposal declined — original specification kept");
          return reviewProposalAction(ex.id, "decline", fd);
        }}
      >
        <Undo2 aria-hidden /> Keep original spec
      </ActionButton>
      {open && proposal && (
        <QuoteEditor
          open={open} onOpenChange={setOpen} order={order} spec={proposal}
          validityDays={7} locked
          title={`Customer proposal · ${order.order_code}`}
          description={`The customer's proposed design. Set the new price (current ${formatPeso(order.furniture_price)}), then send; if it is not feasible, use “Keep original spec”. The customer must accept this revised quotation before production.`}
          submitLabel="Send revised quote"
          onSubmit={(fd) => reviewProposalAction(ex.id, "quote", fd)}
          extra={
            <Field label="Note to customer (optional)" htmlFor="q-note">
              <TextInput id="q-note" name="note" placeholder="e.g. +₱7,000 for the larger Mahogany top" />
            </Field>
          }
        />
      )}
    </div>
  );
}
