"use client";

import { BadgeCheck, Banknote, Building2, Check, Loader2, Smartphone, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { customerAcceptQuotationAction, customerSubmitPaymentAction } from "@/app/customer/actions";
import { Field, TextInput, useServerAction } from "@/components/form";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/domain/finance";
import { PAYMENT_PLAN_LABEL, type PaymentMethod, type PaymentPlan } from "@/lib/domain/types";
import { newUuid } from "@/lib/uuid";
import { cn } from "@/lib/utils";

const PLAN_HINT: Record<PaymentPlan, string> = {
  down_30: "Pay 30% now; production starts once it is verified. The rest is paid on delivery.",
  installment: "No down payment: the price is split into 2 to 6 payments, one every 15 days. Production starts once the owner approves your installment plan.",
  full: "Pay the whole amount before production starts. Nothing to pay on delivery except any delivery fee.",
};
const CHANNELS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "Cash", label: "Cash at the shop", icon: Banknote },
  { value: "Online Payment (GCash / Maya)", label: "GCash / Maya", icon: Smartphone },
  { value: "Bank Transfer", label: "Bank transfer", icon: Building2 },
];

/** A row of pill-shaped radio choices (one choice per group). */
function PillChoice<T extends string>({ name, legend, value, onChange, options }: {
  name: string; legend: string; value: T; onChange: (v: T) => void;
  options: { value: T; label: string; icon?: typeof Banknote }[];
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value;
          const Icon = o.icon;
          return (
            <label key={o.value} className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-foreground/40",
            )}>
              <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
              {on ? <Check className="size-4" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Accept the issued quotation and choose the payment terms + channel (one idempotency key per page view). */
export function AcceptQuotation({ orderCode, revisionNumber, price, fee, down }: {
  orderCode: string; revisionNumber: number; price: number; fee: number; down: number;
}) {
  const [key] = useState(() => newUuid());
  const [plan, setPlan] = useState<PaymentPlan>("down_30");
  const [method, setMethod] = useState<PaymentMethod>("Online Payment (GCash / Maya)");
  const [specOk, setSpecOk] = useState(false);
  const [quoteOk, setQuoteOk] = useState(false);
  const { pending, run } = useServerAction();
  const now = plan === "full" ? price : plan === "down_30" ? down : null;
  return (
    <form data-testid="accept-quotation" className="grid gap-5" onSubmit={(e) => {
      e.preventDefault();
      run(() => customerAcceptQuotationAction(orderCode, {
        expected_revision_number: revisionNumber, accepted_furniture_price: price, accepted_delivery_fee: fee,
        client_idempotency_key: key, accept_specification: specOk, accept_quotation: quoteOk, payment_plan: plan, payment_method: method,
      }));
    }}>
      <PillChoice name="payment_plan" legend="How do you want to pay?" value={plan} onChange={setPlan}
        options={(["down_30", "installment", "full"] as const).map((p) => ({ value: p, label: PAYMENT_PLAN_LABEL[p] }))} />
      <p className="-mt-3 text-sm text-muted-foreground">{PLAN_HINT[plan]}{now != null && <> You pay <b className="text-foreground tabular-nums">{formatPeso(now)}</b> now.</>}</p>
      <PillChoice name="payment_method" legend="Payment channel" value={method} onChange={setMethod} options={CHANNELS} />
      <div className="grid gap-2 text-sm">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 size-5 accent-[var(--primary)]" checked={specOk} onChange={(e) => setSpecOk(e.target.checked)} />
          <span>I checked the design, size, wood and finish above.</span></label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 size-5 accent-[var(--primary)]" checked={quoteOk} onChange={(e) => setQuoteOk(e.target.checked)} />
          <span>I accept the quotation of <b className="tabular-nums">{formatPeso(price + fee)}</b>{fee > 0 ? ` (furniture ${formatPeso(price)} + delivery ${formatPeso(fee)})` : ""}.</span></label>
      </div>
      <Button type="submit" size="xl" className="w-full rounded-full sm:w-fit" disabled={pending || !specOk || !quoteOk}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <BadgeCheck aria-hidden />} Accept quotation
      </Button>
    </form>
  );
}

export interface ShopAccounts { gcash: string | null; bank: string | null }

/** Online / bank payment: amount, reference number and a photo of the receipt. Saved unverified. */
export function SubmitPayment({ orderCode, suggested, max, preferred, accounts }: {
  orderCode: string; suggested: number | null; max: number; preferred: PaymentMethod | null; accounts: ShopAccounts;
}) {
  const [method, setMethod] = useState<PaymentMethod>(preferred === "Bank Transfer" ? "Bank Transfer" : "Online Payment (GCash / Maya)");
  const [file, setFile] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const txn = useRef(newUuid()); // one key per filled-in form: a double tap can never record two payments
  const { pending, run, errors } = useServerAction();
  const account = method === "Bank Transfer" ? accounts.bank : accounts.gcash;
  return (
    <form ref={form} data-testid="submit-payment" className="grid gap-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("payment_method", method);
      fd.set("client_transaction_id", txn.current);
      run(() => customerSubmitPaymentAction(orderCode, fd), () => {
        form.current?.reset();
        setFile(null);
        txn.current = newUuid();
      });
    }}>
      <PillChoice name="method" legend="I paid by" value={method} onChange={setMethod} options={CHANNELS.filter((c) => c.value !== "Cash")} />
      <p className="-mt-2 text-sm text-muted-foreground">
        {account ? <>Send to <b className="text-foreground">{account}</b>, then enter the reference number from your receipt.</> : "Ask the shop for the account details, then enter the reference number from your receipt."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount paid (₱)" htmlFor="amount" required error={errors.amount}>
          <TextInput id="amount" name="amount" type="number" inputMode="decimal" min="1" max={max} step="0.01" required defaultValue={suggested ?? undefined} />
        </Field>
        <Field label="Reference number" htmlFor="reference_number" required error={errors.reference_number} hint="From your GCash, Maya or bank receipt">
          <TextInput id="reference_number" name="reference_number" required minLength={3} maxLength={60} autoComplete="off" />
        </Field>
      </div>
      <label htmlFor="proof" className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-foreground/30 px-4 py-3 text-sm hover:border-foreground/60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40">
        <Upload className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1"><b className="block">{file ?? "Add a photo of your receipt"}</b><span className="text-muted-foreground">JPG, PNG, WebP or PDF, up to 5 MB</span></span>
        <input id="proof" name="proof" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
      </label>
      <Button type="submit" size="xl" className="w-full rounded-full sm:w-fit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Send payment for checking
      </Button>
    </form>
  );
}
