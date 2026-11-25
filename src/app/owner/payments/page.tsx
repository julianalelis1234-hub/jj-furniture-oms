import { PaymentsToVerify } from "@/components/office/payments-to-verify";
import { OwnerShell } from "@/components/owner/owner-shell";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";

export const metadata = { title: "Payments to verify" };

/** Owner · Payments to verify: the same list as the staff, opening orders in the owner's queue. */
export default async function OwnerPayments() {
  const actor = await requireActor(["owner"]);
  const { data, badges } = await loadOwnerContext(await getStore());
  return (
    <OwnerShell actor={actor} badges={badges}>
      <PaymentsToVerify data={data} ordersPath="/owner/orders" />
    </OwnerShell>
  );
}
