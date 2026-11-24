import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { RequestForm } from "./request-form";

export const metadata = { title: "Customize & request a quote" };

/** Customer portal Option 2: the configurator + Customer Email; creates a Quote Requested order. No login needed. */
export default function CustomizePage() {
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-6xl gap-4">
        <div>
          <LinkButton href="/customer/login" variant="ghost" className="-ml-2 mb-1"><ArrowLeft aria-hidden /> Customer portal</LinkButton>
          <h1 className="text-2xl font-bold sm:text-3xl">Customize & request a quote</h1>
          <p className="mt-1 text-muted-foreground">
            Build your piece below. JJ Enterprises will check it and email you an official quotation — nothing is ordered or charged until you accept it.
          </p>
        </div>
        <RequestForm />
      </div>
    </AppShell>
  );
}
