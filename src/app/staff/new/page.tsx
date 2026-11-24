import { PageHeading } from "@/components/dashboard";
import { StaffShell } from "@/components/staff-shell";
import { loadOfficeData } from "@/lib/server/office-data";
import { LinkButton } from "@/components/link-button";
import { getStore, requireActor } from "@/lib/server/context";
import { NewOrderForm } from "./new-order-form";

export const metadata = { title: "New Order" };

export default async function NewOrderPage() {
  const actor = await requireActor(["owner", "staff"]);
  const store = await getStore();
  const [profiles, data] = await Promise.all([store.listProfiles(), loadOfficeData(store)]);
  const office = profiles.filter((p) => p.is_active && (p.role === "staff" || p.role === "owner"));
  return (
    <StaffShell actor={actor} data={data} live={false}>
      <PageHeading
        title="New order from paper slip"
        description="Copy the handwritten slip exactly. Fields marked * are required."
        actions={<LinkButton href="/staff">Cancel</LinkButton>}
      />
      <NewOrderForm staff={office} currentUserId={actor.id} />
    </StaffShell>
  );
}
