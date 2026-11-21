import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { RequestForm } from "./request-form";

export const metadata = { title: "Design & request furniture" };

/** CU-01 Option 2: customer self-service configurator and quote request. */
export default function RequestPage() {
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-6xl gap-4">
        <div>
          <LinkButton href="/track" variant="ghost" className="-ml-2 mb-1"><ArrowLeft aria-hidden /> Customer portal</LinkButton>
          <h1 className="text-2xl font-bold sm:text-3xl">Design & request custom furniture</h1>
          <p className="mt-1 text-muted-foreground">
            Build your piece below. JJ Furniture will check it and send you an official quotation — nothing is ordered or charged until you accept it.
          </p>
        </div>
        <RequestForm />
      </div>
    </AppShell>
  );
}
