"use client";

import { CheckCircle2, KeyRound, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { customerRequestAction } from "@/app/actions";
import { Field, NativeSelect, TextArea, TextInput, useServerAction } from "@/components/form";
import { LinkButton } from "@/components/link-button";
import { emptyConfig, FurnitureConfigurator, type ConfigValue } from "@/components/orders/FurnitureConfigurator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MUNICIPALITIES } from "@/lib/domain/types";
import { newUuid } from "@/lib/uuid";

export function RequestForm() {
  const { pending, run, errors } = useServerAction();
  const [config, setConfig] = useState<ConfigValue>(emptyConfig);
  // one idempotency key per form: a double tap or a retry never creates two requests
  const [requestKey] = useState(() => newUuid());
  const [done, setDone] = useState<{ order_code: string; pin: string } | null>(null);
  const err = (k: string) => errors[k];

  if (done) {
    return (
      <Card className="mx-auto w-full max-w-xl border-success" data-testid="request-done">
        <CardContent className="grid gap-3 pt-4 text-center">
          <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
          <p className="text-lg font-bold">Request sent to JJ Furniture</p>
          <p className="text-sm text-muted-foreground">Write these down or take a screenshot. You need both to see your quotation.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border bg-secondary p-3">
              <p className="text-xs uppercase text-muted-foreground">Order ID</p>
              <p className="font-mono text-xl font-black" data-testid="request-code">{done.order_code}</p>
            </div>
            <div className="rounded-xl border bg-secondary p-3">
              <p className="text-xs uppercase text-muted-foreground">PIN</p>
              <p className="font-mono text-xl font-black tracking-[0.3em]" data-testid="request-pin">{done.pin}</p>
            </div>
          </div>
          <p className="text-sm">The shop will check your design and send an official quotation. You will accept it on the order page.</p>
          <LinkButton href="/track/order" variant="default" size="xl"><KeyRound aria-hidden /> View my request</LinkButton>
        </CardContent>
      </Card>
    );
  }

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

      <Card>
        <CardHeader><CardTitle>1 · Design your furniture</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <FurnitureConfigurator value={config} onChange={setConfig} errors={errors} showQuantity />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Notes for the shop (optional)" htmlFor="special_instructions" className="sm:col-span-2"
              hint="e.g. number of drawers, handle style, where it will stand.">
              <TextArea id="special_instructions" name="special_instructions" maxLength={1000} />
            </Field>
            <Field label="Reference photo link (optional)" htmlFor="reference_photo_url" error={err("reference_photo_url")} className="sm:col-span-2"
              hint="A Facebook / Google Drive / Messenger photo link of the style you like.">
              <TextInput id="reference_photo_url" name="reference_photo_url" type="url" placeholder="https://…" invalid={!!err("reference_photo_url")} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2 · Your contact and delivery details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" htmlFor="customer_name" required error={err("customer_name")}>
            <TextInput id="customer_name" name="customer_name" autoComplete="name" invalid={!!err("customer_name")} />
          </Field>
          <Field label="Mobile number" htmlFor="customer_phone" required error={err("customer_phone")} hint="09XX XXX XXXX — for your quotation updates">
            <TextInput id="customer_phone" name="customer_phone" inputMode="tel" autoComplete="tel" placeholder="09XX XXX XXXX" invalid={!!err("customer_phone")} />
          </Field>
          <Field label="Municipality" htmlFor="municipality" required error={err("municipality")} hint="Delivery inside Valencia City is free.">
            <NativeSelect id="municipality" name="municipality" defaultValue="Valencia City" options={MUNICIPALITIES} />
          </Field>
          <Field label="Delivery address" htmlFor="delivery_address" required error={err("delivery_address")} hint="Purok, barangay and a landmark.">
            <TextInput id="delivery_address" name="delivery_address" autoComplete="street-address" invalid={!!err("delivery_address")} />
          </Field>
        </CardContent>
      </Card>

      {errors._form && <p className="text-sm font-medium text-destructive">{errors._form}</p>}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" size="xl" className="h-auto min-h-12 w-full py-2 whitespace-normal sm:w-auto" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Send request for quotation
        </Button>
      </div>
    </form>
  );
}
