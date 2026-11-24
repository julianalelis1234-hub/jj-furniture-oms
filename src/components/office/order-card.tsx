import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status";
import type { ClientOrder } from "@/lib/client-order";
import { cn } from "@/lib/utils";

/** A flat task row (hairline between rows, a coloured edge for the kind of task). Use inside <ul className="divide-y ..."> */
export function TaskCard({
  order,
  tone = "default",
  children,
  meta,
  actions,
}: {
  order: Pick<ClientOrder, "id" | "order_code" | "customer_name" | "item_name" | "status" | "paper_slip_number">;
  tone?: "default" | "warning" | "danger" | "info";
  children?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "min-w-0 border-l-4 border-l-transparent py-3.5 pl-3 sm:pl-4",
        tone === "warning" && "border-l-warning",
        tone === "danger" && "border-l-destructive",
        tone === "info" && "border-l-info",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <Link href={`/staff/orders/${order.id}`} className="font-bold underline-offset-4 hover:underline">
            {order.order_code}
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">{order.paper_slip_number ? `Slip ${order.paper_slip_number}` : "No slip yet"}</span>
          <p className="truncate text-sm">
            {order.customer_name} · {order.item_name}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      {meta && <div className="mt-1.5 text-sm text-muted-foreground">{meta}</div>}
      {children}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </li>
  );
}
