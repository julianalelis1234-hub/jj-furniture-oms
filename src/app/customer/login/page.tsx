import { KeyRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isDemoMode } from "@/lib/config";
import { DEMO_CUSTOMER_LOGIN } from "@/lib/data/seed";
import { getCustomer } from "@/lib/server/customer-auth";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Customer login" };

export default async function CustomerLoginPage() {
  if (await getCustomer()) redirect("/customer/orders");
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid w-full max-w-sm gap-4">
        <div className="text-center">
          <KeyRound className="mx-auto size-9 text-primary" aria-hidden />
          <h1 className="mt-2 text-2xl font-bold">Customer login</h1>
          <p className="mt-1 text-sm text-muted-foreground">See all your JJ Furniture orders, quotations and payments.</p>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <LoginForm demo={isDemoMode() ? { email: DEMO_CUSTOMER_LOGIN.email, password: DEMO_CUSTOMER_LOGIN.password } : undefined} />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          No account yet? You get one after you accept a quotation from the link we email you. <Link href="/track" className="text-primary underline">Track by Order ID</Link>
        </p>
      </div>
    </AppShell>
  );
}
