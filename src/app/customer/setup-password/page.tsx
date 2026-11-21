import { AppShell } from "@/components/app-shell";
import { SetPasswordForm } from "../auth-forms";

export const metadata = { title: "Set your password" };

/** Reached from the emailed set-up / reset link (demo: ?token=…; production: after /customer/auth/confirm). */
export default async function SetupPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await searchParams).token;
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid w-full max-w-sm gap-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">You will use it with your email to log in to your JJ Furniture account.</p>
        </div>
        <div className="rounded-2xl border bg-card p-5"><SetPasswordForm token={typeof token === "string" ? token : null} /></div>
      </div>
    </AppShell>
  );
}
