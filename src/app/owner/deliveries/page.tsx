import { DeliveriesBoard } from "@/components/office/deliveries-board";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";

export const metadata = { title: "Deliveries" };

/** Deliveries: what to schedule, what is on the road, and what came back. */
export default async function OwnerDeliveries() {
  const actor = await requireActor(["owner"]);
  const { data, badges } = await loadOwnerContext(await getStore());
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Deliveries" description="Riders, trips and the money each delivery collects." />
      <DeliveriesBoard data={data} ordersPath="/owner/orders" />
    </OwnerShell>
  );
}
