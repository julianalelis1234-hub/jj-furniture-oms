import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { RequestForm } from "./request-form";

export const metadata = { title: "Design your piece" };

/** The 3D designer + contact details; submitting creates a JJ-YYYY-#### order waiting for the shop's confirmation. No login needed. */
export default function CustomizePage() {
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-6xl gap-4">
        <div>
          <LinkButton href="/" variant="ghost" className="-ml-2 mb-1"><ArrowLeft aria-hidden /> Home</LinkButton>
          <h1 className="text-3xl sm:text-4xl">Design your piece</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Build it in 3D, then submit. You get your Order ID and slip right away. The shop confirms your order, then sends the official quotation; nothing is charged until you accept it.
          </p>
        </div>
        <RequestForm />
      </div>
    </AppShell>
  );
}
