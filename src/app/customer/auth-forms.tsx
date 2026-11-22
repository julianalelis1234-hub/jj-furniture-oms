"use client";

import { Eye, EyeOff, FlaskConical, KeyRound, Loader2, LogIn, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { customerForgotAction, customerLoginAction, customerSetPasswordAction, demoCustomerLoginAction } from "@/app/customer/actions";
import { Field, TextInput } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type R = ActionResult | null;

/** `demoName` is passed ONLY in Demo Mode (the server action refuses outside it as well). */
export function LoginForm({ demoName }: { demoName?: string }) {
  const [state, action, pending] = useActionState<R, FormData>(customerLoginAction, null);
  const [demoState, setDemoState] = useState<R>(null);
  const [demoPending, startDemo] = useTransition();
  // controlled: React resets uncontrolled inputs after a form action
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const shown = demoState ?? state;
  return (
    <form action={action} className="grid gap-3" noValidate>
      <Field label="Email" htmlFor="email" required error={state?.ok === false ? state.fieldErrors?.email : undefined}>
        <TextInput id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <TextInput id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {shown && !shown.ok && <p role="alert" className="text-sm font-medium text-destructive" data-testid="login-error">{shown.message}</p>}
      <Button type="submit" size="xl" className="w-full rounded-full" disabled={pending || demoPending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />} Log In to Track My Orders</Button>
      <Link href="/customer/forgot-password" className="text-center text-sm text-primary underline">Forgot Password?</Link>
      {demoName && (
        <Button type="button" variant="outline" size="xl" className="h-auto min-h-12 w-full rounded-full border-dashed py-2 whitespace-normal" disabled={pending || demoPending}
          data-testid="demo-customer-login"
          onClick={() => startDemo(async () => { setDemoState((await demoCustomerLoginAction()) ?? null); })}>
          {demoPending ? <Loader2 className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />} Demo Customer Login ({demoName})
        </Button>
      )}
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState<R, FormData>(customerForgotAction, null);
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="grid gap-3" noValidate>
      <Field label="Email" htmlFor="email" required error={state?.ok === false ? state.fieldErrors?.email : undefined}>
        <TextInput id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {state && <p role="status" className={state.ok ? "text-sm" : "text-sm text-destructive"} data-testid="forgot-result">{state.message}</p>}
      <Button type="submit" size="xl" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />} Send reset link</Button>
    </form>
  );
}

/** 0–4 estimate for feedback only; the server and Supabase Auth make the real decision. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "Enter a password" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8 || /^(.)\1+$/.test(pw)) score = Math.min(score, 1);
  const s = score as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ["Too short", "Weak", "Fair", "Good", "Strong"][s] };
}

export function SetPasswordForm({ token }: { token: string | null }) {
  const [state, action, pending] = useActionState<R, FormData>(customerSetPasswordAction.bind(null, token), null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const strength = passwordStrength(pw);
  const longEnough = pw.length >= 8;
  const matches = pw.length > 0 && pw === confirm;
  const canSubmit = longEnough && matches && !pending;
  return (
    <form action={action} className="grid gap-3" noValidate>
      <Field label="New password" htmlFor="password" required hint="At least 8 characters. Avoid your name or email.">
        <div className="relative">
          <TextInput id="password" name="password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128}
            value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="pw-strength" className="pr-12" />
          <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? "Hide passwords" : "Show passwords"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-primary hover:bg-accent-soft" data-testid="toggle-password">
            {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        </div>
      </Field>
      <div id="pw-strength" aria-live="polite" className="grid gap-1" data-testid="password-strength" data-score={strength.score}>
        <div className="grid grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("h-1.5 rounded-full", strength.score >= i ? (strength.score >= 3 ? "bg-success" : strength.score === 2 ? "bg-live" : "bg-destructive") : "bg-stage-track")} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Strength: <b className="text-foreground">{strength.label}</b>{!longEnough && pw ? ` · ${8 - pw.length} more character${8 - pw.length === 1 ? "" : "s"} needed` : ""}</p>
      </div>
      <Field label="Type it again" htmlFor="confirm" required error={state?.ok === false ? state.fieldErrors?.confirm : confirm && !matches ? "The two passwords do not match yet." : undefined}>
        <TextInput id="confirm" name="confirm" type={show ? "text" : "password"} autoComplete="new-password" maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {state && !state.ok && <p role="alert" className="text-sm font-medium text-destructive" data-testid="setup-error">{state.message}</p>}
      <Button type="submit" size="xl" className="w-full rounded-full" disabled={!canSubmit} aria-disabled={!canSubmit}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />} Save password
      </Button>
      {!canSubmit && !pending && <p className="text-center text-xs text-muted-foreground">The button turns on when both passwords match and have at least 8 characters.</p>}
    </form>
  );
}
