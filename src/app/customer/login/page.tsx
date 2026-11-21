import { KeyRound, PencilRuler } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { isDemoMode } from "@/lib/config";
import { DEMO_CUSTOMER_LOGIN } from "@/lib/data/seed";
import { getCustomer } from "@/lib/server/customer-auth";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Customer portal" };

/**
 * Customer portal landing. Option 1: Log In to Track My Orders (email + password).
 * Option 2: Customize & Request a Quote. Quotations themselves are opened from the
 * single-use review link in the shop's email (/customer/review?token=…).
 */
export default async function CustomerLoginPage() {
  if (await getCustomer()) redirect("/customer/orders");
  const demo = isDemoMode() ? DEMO_CUSTOMER_LOGIN.name : undefined;
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">JJ Furniture customer portal</h1>
          <p className="mt-1 text-muted-foreground">Follow the orders on your account, or design a new piece and ask for a quotation.</p>
        </div>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <section aria-labelledby="opt1" className="grid min-w-0 gap-3 rounded-2xl border-2 border-primary bg-card p-5 shadow-sm" data-testid="option-1">
            <h2 id="opt1" className="flex items-center gap-2 text-lg font-bold">
              <KeyRound className="size-5 text-primary" aria-hidden /> Option 1 · Log In to Track My Orders
            </h2>
            <p className="text-sm text-muted-foreground">See every order on your account: status, approved specification, quotation and payments.</p>
            <LoginForm demoName={demo} />
            <p className="text-xs text-muted-foreground">
              No account yet? You get one after you accept a quotation from the secure link JJ Furniture emails you.
            </p>
          </section>
          <section aria-labelledby="opt2" className="grid min-w-0 gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <h2 id="opt2" className="flex items-center gap-2 text-lg font-bold">
              <PencilRuler className="size-5 text-primary" aria-hidden /> Option 2 · Customize & Request a Quote
            </h2>
            <p className="text-sm">Choose the furniture type, design, exact size, wood and finish. The live preview shows it next to a 165 cm person for scale.</p>
            <ol className="grid gap-1 text-sm text-muted-foreground">
              <li>1. Design your piece and enter your email.</li>
              <li>2. JJ Furniture checks it and emails you the official quotation with a secure link.</li>
              <li>3. Accept it from that link, then create your password to follow your orders here.</li>
            </ol>
            <LinkButton href="/customer/customize" variant="default" size="xl" className="w-full" data-testid="option-2">
              <PencilRuler aria-hidden /> Customize & Request a Quote
            </LinkButton>
            <p className="text-xs text-muted-foreground">No account needed. Nothing is ordered or charged until you accept a quotation.</p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
