import { AppShell, PageTitle } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { getStore, requireActor } from "@/lib/server/context";
import { NewOrderForm } from "./new-order-form";

export const metadata = { title: "New Order" };

export default async function NewOrderPage() {
  const actor = await requireActor(["owner", "staff"]);
  const profiles = await (await getStore()).listProfiles();
  const office = profiles.filter((p) => p.is_active && (p.role === "staff" || p.role === "owner"));
  return (
    <AppShell portal={actor.role === "owner" ? "owner" : "staff"} actor={actor}>
      <PageTitle
        title="New order from paper slip"
        description="Copy the handwritten slip exactly. Fields marked * are required."
        actions={<LinkButton href="/staff">Cancel</LinkButton>}
      />
      <NewOrderForm staff={office} currentUserId={actor.id} />
    </AppShell>
  );
}
