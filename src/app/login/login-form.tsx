"use client";

import { ArrowRight, Loader2, LogIn } from "lucide-react";
import { useActionState, useRef } from "react";
import { signIn } from "@/app/actions";
import { Field, PasswordInput, TextInput } from "@/components/form";
import { Button } from "@/components/ui/button";

export type DemoAccountRow = { key: string; email: string; label: string; person: string };

/**
 * One sign-in for staff, owner, craftsman, rider and customer accounts. In Demo Mode the six
 * fixed demo accounts are listed as flat rows: choosing one fills the form and signs in.
 */
export function LoginForm({ demo }: { demo?: { accounts: DemoAccountRow[]; password: string } }) {
  const [state, action, pending] = useActionState(signIn, null);
  const form = useRef<HTMLFormElement>(null);
  const signInAs = (email: string) => {
    const f = form.current;
    if (!f || !demo) return;
    (f.elements.namedItem("email") as HTMLInputElement).value = email;
    (f.elements.namedItem("password") as HTMLInputElement).value = demo.password;
    f.requestSubmit();
  };
  return (
    <div className="grid gap-8">
      <form ref={form} action={action} className="grid gap-3">
        <Field label="Email" htmlFor="email" required>
          <TextInput id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password" required>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </Field>
        {state && !state.ok && <p role="alert" className="text-sm font-semibold text-destructive">{state.message}</p>}
        <Button type="submit" size="xl" disabled={pending} className="rounded-full">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />} Sign in
        </Button>
      </form>

      {demo && (
        <section aria-labelledby="demo-accounts" className="grid gap-3">
          <div>
            <h2 id="demo-accounts" className="text-xl">Demo accounts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every demo account uses the password <b className="font-mono text-foreground">{demo.password}</b>. The Demo account adds a role-switcher bar for presentations.
            </p>
          </div>
          <ul className="divide-y divide-border border-y border-border" data-testid="demo-accounts">
            {demo.accounts.map((a) => (
              <li key={a.key}>
                <button type="button" disabled={pending} onClick={() => signInAs(a.email)} aria-label={`Sign in as ${a.label}`} data-account={a.key}
                  className="group flex w-full items-center gap-3 px-1 py-3.5 text-left transition-colors hover:bg-accent-soft/60 focus-visible:bg-accent-soft focus-visible:outline-none disabled:opacity-60 sm:px-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{a.label}</span>
                    <span className="block text-sm text-muted-foreground">{a.person} · <span className="break-all">{a.email}</span></span>
                  </span>
                  <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
