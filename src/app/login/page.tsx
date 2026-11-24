import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app-shell";
import { isDemoMode } from "@/lib/config";
import { DEMO_ACCOUNT_PASSWORD, demoAccounts } from "@/lib/data/seed";
import { getActor, PORTAL_FOR } from "@/lib/server/context";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/** Sign in for every account. Demo Mode lists the six fixed demo accounts. */
export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(PORTAL_FOR[actor.role]);
  const demo = isDemoMode() ? { accounts: demoAccounts().map(({ key, email, label, person }) => ({ key, email, label, person })), password: DEMO_ACCOUNT_PASSWORD } : undefined;
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-8 px-4 py-10">
      <Logo />
      <div>
        <h1 className="text-3xl sm:text-4xl">Sign in</h1>
        <p className="mt-2 text-muted-foreground">
          Owner, staff, craftsmen, delivery riders and customers all sign in here. Customers get a password after the shop confirms their first order.
        </p>
      </div>
      <LoginForm demo={demo} />
      <p className="text-sm text-muted-foreground">
        Forgot your customer password? <Link href="/customer/forgot-password" className="font-semibold text-foreground underline underline-offset-4">Get a reset link</Link>
        {" · "}<Link href="/" className="font-semibold text-foreground underline underline-offset-4">Back to home</Link>
      </p>
    </main>
  );
}
