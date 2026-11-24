import { PageHeading } from "@/components/dashboard";
import { DeliveriesBoard } from "@/components/office/deliveries-board";
import { StaffShell } from "@/components/staff-shell";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData } from "@/lib/server/office-data";

export const metadata = { title: "Deliveries" };

/** Staff · Deliveries: schedule riders for finished orders and follow every trip. */
export default async function StaffDeliveries() {
  const actor = await requireActor(["staff", "owner"]);
  const data = await loadOfficeData(await getStore());
  return (
    <StaffShell actor={actor} data={data}>
      <PageHeading title="Deliveries" description="Schedule a rider for every finished order and follow each trip." />
      <DeliveriesBoard data={data} ordersPath="/staff/orders" />
    </StaffShell>
  );
}
