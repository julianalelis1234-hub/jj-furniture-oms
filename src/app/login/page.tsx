import { redirect } from "next/navigation";
import { Logo } from "@/components/app-shell";
import { isDemoMode } from "@/lib/config";
import { getActor, PORTAL_FOR } from "@/lib/server/context";
import { LoginForm } from "./login-form";

export const metadata = { title: "Staff sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (isDemoMode()) redirect("/");
  const actor = await getActor();
  if (actor) redirect(PORTAL_FOR[actor.role]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <Logo />
      <div>
        <h1 className="text-2xl font-bold">Staff sign in</h1>
        <p className="text-muted-foreground">Your role (owner, staff, craftsman, driver) is checked on the server.</p>
      </div>
      <LoginForm />
    </main>
  );
}
