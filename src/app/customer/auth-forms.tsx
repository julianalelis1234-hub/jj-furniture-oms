"use client";

import { FlaskConical, KeyRound, Loader2, LogIn, Mail } from "lucide-react";
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
      <Button type="submit" size="xl" disabled={pending || demoPending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />} Log in</Button>
      <Link href="/customer/forgot-password" className="text-center text-sm text-primary underline">Forgot Password?</Link>
      {demoName && (
        <Button type="button" variant="outline" size="xl" className="h-auto min-h-12 border-dashed py-2 whitespace-normal" disabled={pending || demoPending}
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
