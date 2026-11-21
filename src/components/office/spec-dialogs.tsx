"use client";

import { Loader2, PencilRuler, Undo2 } from "lucide-react";
import { useState } from "react";
import { reviewProposalAction, reviseSpecsAction } from "@/app/actions";
import { ActionButton } from "@/components/action-dialog";
import { Field, TextInput, useServerAction } from "@/components/form";
import { configFromSpec, emptyConfig, FurnitureConfigurator, type ConfigValue } from "@/components/orders/FurnitureConfigurator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ClientOrder } from "@/lib/client-order";
import { formatPeso } from "@/lib/domain/finance";
import { isConfiguratorFinish, type FurnitureSpec } from "@/lib/domain/furniture";
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
  if (!isConfiguratorFinish(c.color_finish)) c.color_finish = "Natural Varnish";
  return c;
}

/** Configurator + price/fee in a dialog: issues a new revised-quote revision. */
function QuoteEditor({
  open, onOpenChange, title, description, order, spec, submitLabel, onSubmit, extra,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; order: ClientOrder; spec: FurnitureSpec;
  submitLabel: string; onSubmit: (fd: FormData) => ReturnType<typeof reviseSpecsAction>; extra?: React.ReactNode;
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
          <FurnitureConfigurator value={config} onChange={setConfig} errors={errors} showQuantity inDialog />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Furniture price (₱)" htmlFor="q-price" required error={errors.furniture_price}>
              <TextInput id="q-price" name="furniture_price" type="number" min="1" step="0.01" defaultValue={order.furniture_price} required className="tabular-nums" />
            </Field>
            <Field label="Delivery fee (₱)" htmlFor="q-fee" error={errors.delivery_fee} hint={valencia ? "Valencia City: always FREE." : `${order.municipality}: distance fee.`}>
              <TextInput id="q-fee" name="delivery_fee" type="number" min="0" step="1" defaultValue={valencia ? 0 : order.delivery_fee} readOnly={valencia} className="tabular-nums" />
            </Field>
            {extra}
          </div>
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

/** Staff/owner: change spec or price before production (new revised quote). */
export function ReviseSpecsDialog({ order }: { order: ClientOrder }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="touch" onClick={() => setOpen(true)}><PencilRuler aria-hidden /> Revise specs / quote</Button>
      {open && (
        <QuoteEditor
          open={open} onOpenChange={setOpen} order={order} spec={orderSpec(order)}
          title={`Revised quote · ${order.order_code}`}
          description={`Saved as revision ${(order.current_revision ?? 0) + 1}. Any change voids the customer's confirmation; they must confirm the new revision before production.`}
          submitLabel="Save revised quote"
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
          title={`Customer proposal · ${order.order_code}`}
          description={`Pre-filled with the customer's proposal. Adjust anything that is not feasible, set the new price (current ${formatPeso(order.furniture_price)}), then send. The customer must confirm this revised quote before production.`}
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
