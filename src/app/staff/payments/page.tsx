import { PaymentsToVerify } from "@/components/office/payments-to-verify";
import { StaffShell } from "@/components/staff-shell";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData } from "@/lib/server/office-data";

export const metadata = { title: "Payments to verify" };

/** Staff · Payments: customer transfers and rider cash waiting to be checked, and orders still short of the 30%. */
export default async function StaffPayments() {
  const actor = await requireActor(["staff", "owner"]);
  const data = await loadOfficeData(await getStore());
  return (
    <StaffShell actor={actor} data={data}>
      <PaymentsToVerify data={data} ordersPath="/staff/orders" />
    </StaffShell>
  );
}
