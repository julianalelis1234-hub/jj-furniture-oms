"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { NativeSelect, TextInput } from "@/components/form";
import { StatusBadge } from "@/components/status";
import type { ClientOrder } from "@/lib/client-order";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { MUNICIPALITIES, ORDER_STATUSES } from "@/lib/domain/types";

export function OrdersTable({ orders }: { orders: ClientOrder[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [place, setPlace] = useState("all");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (status === "all" || o.status === status) &&
        (place === "all" || o.municipality === place) &&
        (!needle ||
          [o.order_code, o.paper_slip_number, o.customer_name, o.customer_phone, o.item_name].some((f) => (f ?? "").toLowerCase().includes(needle))),
    );
  }, [orders, q, status, place]);

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px_180px] [&>*]:min-w-0">
        <label className="relative">
          <span className="sr-only">Search orders</span>
          <Search className="absolute top-3 left-3 size-5 text-muted-foreground" aria-hidden />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order ID, slip #, name, phone, item" className="pl-10" />
        </label>
        <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: "all", label: "All stages" }, ...ORDER_STATUSES.map((s) => ({ value: s, label: s }))]} />
        <NativeSelect aria-label="Filter by municipality" value={place} onChange={(e) => setPlace(e.target.value)}
          options={[{ value: "all", label: "All places" }, ...MUNICIPALITIES.map((s) => ({ value: s, label: s }))]} />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{rows.length} order(s)</p>
      {rows.length === 0 ? (
        <EmptyState title="No orders match">Try a different search or clear the filters.</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 [&>li]:min-w-0">
          {rows.map((o) => (
            <li key={o.id}>
              <Link href={`/staff/orders/${o.id}`} className="block rounded-xl border bg-card p-3 hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{o.order_code} <span className="text-xs font-normal text-muted-foreground">{o.paper_slip_number ? `Slip #${o.paper_slip_number}` : "Portal request"}</span></p>
                    <p className="truncate text-sm">{o.customer_name} · {o.municipality}</p>
                    <p className="truncate text-sm text-muted-foreground">{o.quantity} × {o.item_name}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                  <span>Done by {formatDate(o.estimated_completion_date)}</span>
                  <span>Collect {formatPeso(o.collectible_on_delivery)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
