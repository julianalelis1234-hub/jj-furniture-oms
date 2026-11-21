import { KeyRound, PencilRuler, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { isDemoMode } from "@/lib/config";
import { DEMO_CUSTOMER_SAMPLES } from "@/lib/data/seed";
import { LookupForm } from "./lookup-form";

export const metadata = { title: "Customer portal" };

/** CU-01: Option 1 (Track or Confirm My Order) next to Option 2 (Design & Request Custom Furniture). */
export default async function TrackPage({ searchParams }: PageProps<"/track">) {
  const code = (await searchParams).code;
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">JJ Furniture customer portal</h1>
          <p className="mt-1 text-muted-foreground">Track an order you already placed, or design a new piece and ask for a quotation.</p>
        </div>
        {/* phones: both options visible at the top before the long Option 1 form */}
        <nav aria-label="Choose an option" className="grid grid-cols-2 gap-2 lg:hidden">
          <LinkButton href="#opt1" variant="outline" className="h-auto min-h-12 py-2 whitespace-normal"><Search aria-hidden /> Track or confirm my order</LinkButton>
          <LinkButton href="/track/request" variant="default" className="h-auto min-h-12 py-2 whitespace-normal"><PencilRuler aria-hidden /> Design & request furniture</LinkButton>
        </nav>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section aria-labelledby="opt1" className="grid min-w-0 gap-2">
            <h2 id="opt1" className="flex items-center gap-2 text-lg font-bold">
              <Search className="size-5 text-primary" aria-hidden /> Option 1 · Track or Confirm My Order
            </h2>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3" data-testid="login-callout">
              <KeyRound className="size-5 text-primary" aria-hidden />
              <p className="min-w-0 flex-1 text-sm">Have an account? Log in with your email and password to see all your orders.</p>
              <LinkButton href="/customer/login" variant="default">Customer login</LinkButton>
            </div>
            <p className="text-sm text-muted-foreground">
              Or check the status with the Order ID from your slip. Quotations are accepted from the secure link we email you.
            </p>
            <LookupForm initialCode={typeof code === "string" ? code : ""} samples={isDemoMode() ? DEMO_CUSTOMER_SAMPLES : []} />
          </section>
          <section aria-labelledby="opt2" className="grid min-w-0 gap-3 rounded-2xl border bg-card p-4 shadow-sm">
            <h2 id="opt2" className="flex items-center gap-2 text-lg font-bold">
              <PencilRuler className="size-5 text-primary" aria-hidden /> Option 2 · Design & Request Custom Furniture
            </h2>
            <p className="text-sm">
              Choose the type of furniture, design, exact size, wood and finish. The live preview shows it next to a 165 cm person for scale.
            </p>
            <ol className="grid gap-1 text-sm text-muted-foreground">
              <li>1. Design your piece and send the request.</li>
              <li>2. Get your Order ID right away.</li>
              <li>3. JJ Furniture checks it and emails you the official quotation with a secure link.</li>
              <li>4. Accept it from that link, then set your password to follow your orders.</li>
            </ol>
            <LinkButton href="/track/request" variant="default" size="xl" className="w-full" data-testid="option-2">
              <PencilRuler aria-hidden /> Design & Request Custom Furniture
            </LinkButton>
            <p className="text-xs text-muted-foreground">No account needed. Nothing is ordered or charged until you accept a quotation.</p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
