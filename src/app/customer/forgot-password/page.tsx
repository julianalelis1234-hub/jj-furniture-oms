import { AppShell } from "@/components/app-shell";
import { ForgotForm } from "../auth-forms";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid w-full max-w-sm gap-4">
        <h1 className="text-center text-2xl font-bold">Reset your password</h1>
        <div className="rounded-2xl border bg-card p-5"><ForgotForm /></div>
      </div>
    </AppShell>
  );
}
