import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeading } from "@/components/dashboard";
import { LinkButton } from "@/components/link-button";
import { PortalShell } from "@/components/portal-shell";
import { getCustomer } from "@/lib/server/customer-auth";
import { CustomerLogoutButton } from "../logout-button";
import { RequestForm } from "./request-form";

export const metadata = { title: "Design your piece" };

/**
 * The 3D designer + contact details; submitting creates a JJ-YYYY-#### order waiting for the shop's confirmation.
 * No login needed. A signed-in customer sees it inside their portal (sidebar); a guest sees the plain page.
 */
export default async function CustomizePage() {
  const customer = await getCustomer();
  const intro = "Build it in 3D, then submit. You get your Order ID and slip right away. The shop confirms your order, then sends the official quotation; nothing is charged until you accept it.";
  const body: ReactNode = <RequestForm />;
  if (customer) {
    return (
      <PortalShell portal="customer" actor={null} name={customer.full_name} live={false}
        signOutControl={<CustomerLogoutButton compact />} headerExtra={<CustomerLogoutButton />}>
        <PageHeading title="Design your piece" description={intro} />
        {body}
      </PortalShell>
    );
  }
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-6xl gap-4">
        <div>
          <LinkButton href="/" variant="ghost" className="-ml-2 mb-1"><ArrowLeft aria-hidden /> Home</LinkButton>
          <h1 className="text-3xl sm:text-4xl">Design your piece</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">{intro}</p>
        </div>
        {body}
      </div>
    </AppShell>
  );
}
