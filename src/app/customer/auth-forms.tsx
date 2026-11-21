"use client";

import { KeyRound, Loader2, LogIn, Mail } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { customerForgotAction, customerLoginAction, customerSetPasswordAction } from "@/app/customer/actions";
import { Field, TextInput } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type R = ActionResult | null;

export function LoginForm({ demo }: { demo?: { email: string; password: string } }) {
  const [state, action, pending] = useActionState<R, FormData>(customerLoginAction, null);
  // controlled: React resets uncontrolled inputs after a form action
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="grid gap-3" noValidate>
      <Field label="Email" htmlFor="email" required error={state?.ok === false ? state.fieldErrors?.email : undefined}>
        <TextInput id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <TextInput id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {state && !state.ok && <p role="alert" className="text-sm font-medium text-destructive" data-testid="login-error">{state.message}</p>}
      <Button type="submit" size="xl" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />} Log in</Button>
      <Link href="/customer/forgot-password" className="text-center text-sm text-primary underline">Forgot password?</Link>
      {demo && (
        <button type="button" onClick={() => { setEmail(demo.email); setPassword(demo.password); }}
          className="rounded-lg border border-dashed p-2 text-left text-xs text-muted-foreground" data-testid="demo-login-fill">
          Demo account (fictional): <b className="text-foreground">{demo.email}</b> · password <b className="text-foreground">{demo.password}</b> — tap to fill
        </button>
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

export function SetPasswordForm({ token }: { token: string | null }) {
  const [state, action, pending] = useActionState<R, FormData>(customerSetPasswordAction.bind(null, token), null);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <Field label="New password" htmlFor="password" required hint="At least 10 characters. Avoid your name or email.">
        <TextInput id="password" name="password" type="password" autoComplete="new-password" minLength={10} />
      </Field>
      <Field label="Type it again" htmlFor="confirm" required error={state?.ok === false ? state.fieldErrors?.confirm : undefined}>
        <TextInput id="confirm" name="confirm" type="password" autoComplete="new-password" />
      </Field>
      {state && !state.ok && <p role="alert" className="text-sm font-medium text-destructive" data-testid="setup-error">{state.message}</p>}
      <Button type="submit" size="xl" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />} Save password</Button>
    </form>
  );
}
