"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { customerRequestAction, type OrderSlip } from "@/app/actions";
import { OrderSlipView } from "./order-slip";
import { CustomizationAssistant } from "@/components/orders/customization-assistant";
import { Field, NativeSelect, TextArea, TextInput, useServerAction } from "@/components/form";
import { emptyConfig, FurnitureConfigurator, type ConfigValue } from "@/components/orders/FurnitureConfigurator";
import { Button } from "@/components/ui/button";
import { MUNICIPALITIES } from "@/lib/domain/types";
import { newUuid } from "@/lib/uuid";

export function RequestForm() {
  const { pending, run, errors } = useServerAction();
  const [config, setConfig] = useState<ConfigValue>(emptyConfig);
  // one idempotency key per form: a double tap or a retry never creates two requests
  const [requestKey] = useState(() => newUuid());
  const [done, setDone] = useState<OrderSlip | null>(null);
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const err = (k: string) => errors[k];

  if (done) return <OrderSlipView slip={done} />;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => customerRequestAction(null, fd), (r) => r.data && setDone(r.data));
      }}
      className="grid gap-4"
    >
      <input type="hidden" name="client_request_key" value={requestKey} />
      {/* honeypot for bots: hidden from people and screen readers */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {/* flat sections, no card: a clipping wrapper would stop the 3D view from staying in place */}
      <section aria-labelledby="step-design" className="grid gap-4">
        <h2 id="step-design" className="text-2xl">Design your furniture</h2>
          <FurnitureConfigurator value={config} onChange={setConfig} errors={errors} showQuantity
            intro={<CustomizationAssistant value={config} onChange={setConfig} onUsePhoto={setPhotoUrl}
              onNotes={(t) => setNotes((n) => (n.includes(t) ? n : [n, t].filter(Boolean).join("\n")))} />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Notes for the shop (optional)" htmlFor="special_instructions" className="sm:col-span-2"
              hint="e.g. number of drawers, handle style, where it will stand.">
              <TextArea id="special_instructions" name="special_instructions" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Field label="Reference photo link (optional)" htmlFor="reference_photo_url" error={err("reference_photo_url")} className="sm:col-span-2"
              hint="A Facebook / Google Drive / Messenger photo link of the style you like.">
              <TextInput id="reference_photo_url" name="reference_photo_url" type="url" placeholder="https://…" invalid={!!err("reference_photo_url")}
                value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
            </Field>
          </div>
      </section>

      <section aria-labelledby="step-contact" className="grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
        <h2 id="step-contact" className="text-2xl sm:col-span-2">Your contact and delivery details</h2>
          <Field label="Your name" htmlFor="customer_name" required error={err("customer_name")}>
            <TextInput id="customer_name" name="customer_name" autoComplete="name" invalid={!!err("customer_name")} />
          </Field>
          <Field label="Customer Email" htmlFor="customer_email" required error={err("customer_email")} hint="Once the shop confirms your order, we email you here to create your password.">
            <TextInput id="customer_email" name="customer_email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" invalid={!!err("customer_email")} />
          </Field>
          <Field label="Mobile number" htmlFor="customer_phone" required error={err("customer_phone")} hint="09XX XXX XXXX">
            <TextInput id="customer_phone" name="customer_phone" inputMode="tel" autoComplete="tel" placeholder="09XX XXX XXXX" invalid={!!err("customer_phone")} />
          </Field>
          <Field label="Municipality" htmlFor="municipality" required error={err("municipality")} hint="Delivery inside Valencia City is free.">
            <NativeSelect id="municipality" name="municipality" defaultValue="Valencia City" options={MUNICIPALITIES} />
          </Field>
          <Field label="Delivery address" htmlFor="delivery_address" required error={err("delivery_address")} hint="Purok, barangay and a landmark.">
            <TextInput id="delivery_address" name="delivery_address" autoComplete="street-address" invalid={!!err("delivery_address")} />
          </Field>
      </section>

      {errors._form && <p className="text-sm font-medium text-destructive">{errors._form}</p>}
      {/* on phones it floats just above the bottom navigation (which sits at z-30) */}
      <div className="sticky bottom-24 z-10 -mx-4 border-y bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" size="xl" className="h-auto min-h-12 w-full py-2 whitespace-normal sm:w-auto" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Submit order
        </Button>
      </div>
    </form>
  );
}
