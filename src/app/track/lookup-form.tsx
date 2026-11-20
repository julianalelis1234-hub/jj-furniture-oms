"use client";

import { KeyRound, Loader2, Search } from "lucide-react";
import { startTransition, useActionState, useRef, useState } from "react";
import { customerLookupAction } from "@/app/actions";
import { DesignNote } from "@/components/design-note";
import { Field, TextInput } from "@/components/form";
import { StageTracker } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { STATUS_CUSTOMER_COPY } from "@/lib/domain/status";

type State = Awaited<ReturnType<typeof customerLookupAction>> | null;

export function LookupForm({ initialCode, samples }: { initialCode: string; samples: { order_code: string; pin: string; label: string }[] }) {
  const [state, action, pending] = useActionState<State, FormData>(customerLookupAction, null);
  // Controlled inputs: React resets uncontrolled fields after a form action,
  // which would force customers to retype their Order ID after a wrong PIN.
  const [code, setCode] = useState(initialCode);
  const [pin, setPin] = useState("");
  const pinRef = useRef<HTMLInputElement>(null);
  const track = state?.ok ? state.data.track : null;
  const startLookup = (fd: FormData) => startTransition(() => action(fd));

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="pt-4">
          <form action={action} className="grid gap-3">
            <Field label="Order ID" htmlFor="order_code" required hint="Example: JJ-2026-0145">
              <TextInput id="order_code" name="order_code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required autoCapitalize="characters"
                autoComplete="off" className="font-mono text-lg uppercase" placeholder="JJ-2026-0000" />
            </Field>
            <Field label="4-digit PIN (optional)" htmlFor="pin" hint="Printed on your slip. Needed for prices, confirming specs and repair requests.">
              <TextInput ref={pinRef} id="pin" name="pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off"
                className="font-mono text-lg tracking-[0.5em]" placeholder="••••" />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="submit" size="xl" disabled={pending} onClick={(e) => {
                  // status-only lookup never sends the PIN
                  e.preventDefault();
                  const fd = new FormData(); fd.set("order_code", code); fd.set("pin", "");
                  startLookup(fd);
                }}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />} Check status only
              </Button>
              <Button type="submit" size="xl" variant="outline" disabled={pending} formNoValidate={false}
                onClick={(e) => { if (!pin) { e.preventDefault(); pinRef.current?.focus(); } }}>
                <KeyRound aria-hidden /> Open with PIN
              </Button>
            </div>
            {state && !state.ok && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm font-semibold text-destructive">{state.message}</p>}
          </form>
        </CardContent>
      </Card>

      {samples.length > 0 && (
        <div className="rounded-xl border border-dashed p-3">
          <p className="mb-2 text-sm font-semibold">Demo sample orders (1-click)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {samples.map((s) => (
              <button key={s.order_code} type="button" className="rounded-lg border bg-card p-2 text-left text-sm hover:border-primary"
                onClick={() => {
                  setCode(s.order_code);
                  setPin(s.pin);
                  const fd = new FormData(); fd.set("order_code", s.order_code); fd.set("pin", s.pin);
                  startLookup(fd);
                }}>
                <b className="font-mono">{s.order_code}</b> · PIN {s.pin}
                <span className="block text-xs text-muted-foreground">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {track && (
        <Card aria-live="polite" data-testid="track-result">
          <CardContent className="grid gap-4 pt-4">
            <div>
              <p className="text-sm text-muted-foreground">Order {track.order_code}</p>
              <p className="text-xl font-bold">{track.item_name}</p>
              <p className="mt-1">{STATUS_CUSTOMER_COPY[track.status]}</p>
            </div>
            <StageTracker status={track.status} />
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border p-3"><p className="text-xs uppercase text-muted-foreground">Estimated completion</p><p className="font-bold">{formatDate(track.estimated_completion_date)}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs uppercase text-muted-foreground">Scheduled delivery</p><p className="font-bold">{formatDate(track.scheduled_delivery_date)}</p></div>
            </div>
            <p className="text-xs text-muted-foreground">Last updated {formatDateTime(track.updated_at)}. Enter your PIN above to see the payment summary.</p>
            <DesignNote>Without the PIN, only the stage and the two dates are shown. Anyone holding the slip number cannot see the address, phone number or amounts.</DesignNote>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
