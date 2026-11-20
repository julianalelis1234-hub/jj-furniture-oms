"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createOrderAction } from "@/app/actions";
import { DesignNote } from "@/components/design-note";
import { Field, NativeSelect, TextArea, TextInput, useServerAction } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, todayISO } from "@/lib/domain/dates";
import { formatPeso, previewNewOrder } from "@/lib/domain/finance";
import { MUNICIPALITIES, PAYMENT_EXCEPTION_TYPES, WOOD_TYPES, type Municipality } from "@/lib/domain/types";

export function NewOrderForm({ staff, currentUserId }: { staff: { id: string; full_name: string }[]; currentUserId: string }) {
  const router = useRouter();
  const { pending, run, errors } = useServerAction();
  const [price, setPrice] = useState("");
  const [municipality, setMunicipality] = useState<Municipality>("Valencia City");
  const [fee, setFee] = useState("");
  const [terms, setTerms] = useState("Standard 30/70");
  const preview = previewNewOrder(Number(price) || 0, municipality, Number(fee) || 0);
  const today = todayISO();
  const err = (k: string) => errors[k];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => createOrderAction(null, fd), (r) => r.data && router.push(`/staff/orders/${r.data.id}/slip?new=1`));
      }}
      className="grid gap-4 lg:grid-cols-[1fr_320px]"
    >
      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>1 · Paper slip</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Paper Slip #" htmlFor="paper_slip_number" required error={err("paper_slip_number")}
              hint="The number printed on the handwritten slip. Must be unique.">
              <TextInput id="paper_slip_number" name="paper_slip_number" inputMode="numeric" autoFocus invalid={!!err("paper_slip_number")} />
            </Field>
            <Field label="Encoded by" htmlFor="encoded_by_id" required error={err("encoded_by_id")}>
              <NativeSelect id="encoded_by_id" name="encoded_by_id" defaultValue={currentUserId}
                options={staff.map((s) => ({ value: s.id, label: s.full_name }))} />
            </Field>
            <DesignNote className="sm:col-span-2">
              Paper stays the source of truth at the counter. The unique slip number is the bridge, so a slip can never be encoded twice or go missing.
            </DesignNote>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>2 · Customer</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer name" htmlFor="customer_name" required error={err("customer_name")}>
              <TextInput id="customer_name" name="customer_name" autoComplete="off" invalid={!!err("customer_name")} />
            </Field>
            <Field label="Mobile number" htmlFor="customer_phone" required error={err("customer_phone")} hint="09XX XXX XXXX">
              <TextInput id="customer_phone" name="customer_phone" inputMode="tel" placeholder="0917 123 4567" invalid={!!err("customer_phone")} />
            </Field>
            <Field label="Municipality" htmlFor="municipality" required error={err("municipality")}>
              <NativeSelect id="municipality" name="municipality" value={municipality}
                onChange={(e) => setMunicipality(e.target.value as Municipality)} options={MUNICIPALITIES} />
            </Field>
            <Field label="Delivery fee (₱)" htmlFor="delivery_fee" error={err("delivery_fee")}
              hint={municipality === "Valencia City" ? "Free delivery within Valencia City." : "Distance-based fee for this municipality."}>
              <TextInput id="delivery_fee" name="delivery_fee" type="number" inputMode="decimal" min="0" step="1"
                value={municipality === "Valencia City" ? "0" : fee} disabled={municipality === "Valencia City"}
                onChange={(e) => setFee(e.target.value)} invalid={!!err("delivery_fee")} />
              {municipality === "Valencia City" && <input type="hidden" name="delivery_fee" value="0" />}
            </Field>
            <Field label="Delivery address" htmlFor="delivery_address" required error={err("delivery_address")} className="sm:col-span-2"
              hint="Purok, barangay and a landmark the driver can find.">
              <TextInput id="delivery_address" name="delivery_address" invalid={!!err("delivery_address")} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>3 · Furniture specifications</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Item" htmlFor="item_name" required error={err("item_name")} className="sm:col-span-2">
              <TextInput id="item_name" name="item_name" placeholder="e.g. 6-Seater Dining Table" invalid={!!err("item_name")} />
            </Field>
            <Field label="Dimensions" htmlFor="dimensions" required error={err("dimensions")} hint="L × W × H, e.g. 210cm x 90cm x 76cm">
              <TextInput id="dimensions" name="dimensions" invalid={!!err("dimensions")} />
            </Field>
            <Field label="Quantity" htmlFor="quantity" required error={err("quantity")}>
              <TextInput id="quantity" name="quantity" type="number" inputMode="numeric" min="1" defaultValue="1" invalid={!!err("quantity")} />
            </Field>
            <Field label="Wood type" htmlFor="wood_type" required error={err("wood_type")}>
              <NativeSelect id="wood_type" name="wood_type" defaultValue="Mahogany" options={WOOD_TYPES} />
            </Field>
            <Field label="Color / finish" htmlFor="color_finish" required error={err("color_finish")}>
              <TextInput id="color_finish" name="color_finish" placeholder="e.g. Dark Walnut Gloss" invalid={!!err("color_finish")} />
            </Field>
            <Field label="Special instructions" htmlFor="special_instructions" className="sm:col-span-2">
              <TextArea id="special_instructions" name="special_instructions" />
            </Field>
            <Field label="Reference photo link" htmlFor="reference_photo_url" error={err("reference_photo_url")} className="sm:col-span-2"
              hint="Paste a Messenger / Google Drive photo link if the customer sent one.">
              <TextInput id="reference_photo_url" name="reference_photo_url" type="url" placeholder="https://…" invalid={!!err("reference_photo_url")} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>4 · Dates</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Estimated completion date" htmlFor="estimated_completion_date" required error={err("estimated_completion_date")}>
              <TextInput id="estimated_completion_date" name="estimated_completion_date" type="date" min={today} defaultValue={addDays(today, 14)} />
            </Field>
            <Field label="Scheduled delivery date" htmlFor="scheduled_delivery_date" error={err("scheduled_delivery_date")} hint="Optional — can be set later.">
              <TextInput id="scheduled_delivery_date" name="scheduled_delivery_date" type="date" min={today} />
            </Field>
            <DesignNote className="sm:col-span-2">
              Completion and delivery are two separate dates. Interviews showed customers confused “tapos na” (finished) with “ihatid na” (delivered).
            </DesignNote>
          </CardContent>
        </Card>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <Card className="border-primary/40">
          <CardHeader><CardTitle>5 · Price & payment</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Furniture price (₱)" htmlFor="furniture_price" required error={err("furniture_price")}>
              <TextInput id="furniture_price" name="furniture_price" type="number" inputMode="decimal" min="1" step="0.01"
                value={price} onChange={(e) => setPrice(e.target.value)} className="text-lg font-bold" invalid={!!err("furniture_price")} />
            </Field>
            <Field label="Payment terms" htmlFor="payment_exception_type"
              hint={terms === "Standard 30/70" ? undefined : "Needs owner approval — added to the owner's queue."}>
              <NativeSelect id="payment_exception_type" name="payment_exception_type" value={terms}
                onChange={(e) => setTerms(e.target.value)} options={PAYMENT_EXCEPTION_TYPES} />
            </Field>
            <dl className="grid gap-1.5 rounded-lg bg-muted p-3 text-sm" aria-live="polite">
              <div className="flex justify-between"><dt>30% down payment</dt><dd className="font-bold tabular-nums">{formatPeso(preview.standard_down_payment_due)}</dd></div>
              <div className="flex justify-between"><dt>70% balance</dt><dd className="tabular-nums">{formatPeso(preview.balance_after_down_payment)}</dd></div>
              <div className="flex justify-between"><dt>Delivery fee</dt><dd className="tabular-nums">{preview.delivery_fee === 0 ? "FREE" : formatPeso(preview.delivery_fee)}</dd></div>
              <div className="mt-1 flex justify-between border-t pt-1.5 text-base"><dt className="font-semibold">Collect on delivery</dt><dd className="font-black tabular-nums">{formatPeso(preview.collectible_after_down_payment)}</dd></div>
            </dl>
            <Button type="submit" size="xl" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              {pending ? "Saving…" : "Save order"}
            </Button>
            {Object.keys(errors).length > 0 && (
              <p className="text-sm font-medium text-destructive" role="alert">Please fix {Object.keys(errors).length} highlighted field(s).</p>
            )}
            <p className="text-xs text-muted-foreground">The order is saved as a draft (DR-####) until the customer confirms the specs.</p>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
