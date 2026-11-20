"use client";

import { Loader2, LogIn } from "lucide-react";
import { useActionState } from "react";
import { signIn } from "@/app/actions";
import { Field, TextInput } from "@/components/form";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="grid gap-3">
      <Field label="Email" htmlFor="email" required>
        <TextInput id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <TextInput id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state && !state.ok && <p role="alert" className="text-sm font-semibold text-destructive">{state.message}</p>}
      <Button type="submit" size="xl" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />} Sign in
      </Button>
    </form>
  );
}
