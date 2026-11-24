import { OfficeWorkspace } from "@/components/office/office-workspace";
import { OwnerShell } from "@/components/owner/owner-shell";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";

export const metadata = { title: "Orders & Quotations" };

/** Every order and quotation: the shared queue + order drawer, from the owner's sidebar. */
export default async function OwnerOrders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(["owner"]);
  const sp = await searchParams;
  const { data, badges } = await loadOwnerContext(await getStore());
  const openId = typeof sp.order === "string" ? sp.order : null;
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OfficeWorkspace actor={actor} data={data} basePath="/owner/orders" openId={openId} tab={typeof sp.tab === "string" ? sp.tab : undefined}
        title="Orders & Quotations" description="Confirm new orders, issue quotations, verify payments and follow every order to the door." />
    </OwnerShell>
  );
}
