import { ArrowLeft } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { OrderWorkspace } from "@/components/office/order-workspace";
import { PortalShell } from "@/components/portal-shell";
import { requireActor } from "@/lib/server/context";

/** Full-page version of the order workspace (deep links, printing context); same content as the drawer. */
export default async function OrderDetailPage({ params }: PageProps<"/staff/orders/[id]">) {
  const actor = await requireActor(["staff", "owner"]);
  const { id } = await params;
  const isOwner = actor.role === "owner";
  return (
    <PortalShell portal={isOwner ? "owner" : "staff"} actor={actor} live={{ orderIds: [id] }}>
      <div className="mb-3"><LinkButton href={isOwner ? `/owner?order=${id}` : `/staff?order=${id}`} variant="ghost"><ArrowLeft aria-hidden /> Back to the queue</LinkButton></div>
      <OrderWorkspace orderId={id} actor={actor} variant="page" />
    </PortalShell>
  );
}
