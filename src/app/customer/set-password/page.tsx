import { AppShell } from "@/components/app-shell";
import { Eyebrow } from "@/components/eyebrow";
import { SetPasswordForm } from "../auth-forms";

export const metadata = { title: "Set your password" };

/**
 * Reached from the emailed set-up / reset link.
 *  - production: /auth/callback verified the Supabase recovery token and set the session;
 *    the password is saved with supabase.auth.updateUser({ password })
 *  - demo: the single-use ?token=… from the Demo Inbox link
 */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await searchParams).token;
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid w-full max-w-sm gap-4">
        <div className="text-center">
          <Eyebrow className="mx-auto">Secure account set-up</Eyebrow>
          <h1 className="mt-3 text-3xl font-semibold">Create your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">You will use it with your email to log in to your JJ Furniture account.</p>
        </div>
        <div className="jj-surface rounded-2xl border border-live/70 bg-background p-5 sm:p-6"><SetPasswordForm token={typeof token === "string" ? token : null} /></div>
      </div>
    </AppShell>
  );
}
