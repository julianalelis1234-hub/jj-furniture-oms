"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status";
import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import type { OrderStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/** One scannable queue row. Built on the server WITHOUT emails, phones or addresses (those appear in the drawer only). */
export interface QueueRow {
  id: string;
  code: string;
  created_at: string;
  customer: string;
  account: "verified" | "unverified" | "walk-in" | "unlinked";
  item: string;
  quantity: number;
  dims: string | null;
  material: string;
  status: OrderStatus;
  price: number | null;
  verifiedPaid: number;
  remaining: number;
  down: number;
  deliveryFee: number;
  pct: number;
}
export interface QueueFilter {
  key: string;
  label: string;
  statuses: readonly OrderStatus[];
  count: number;
}

const ACCOUNT: Record<QueueRow["account"], { label: string; cls: string }> = {
  verified: { label: "Verified account", cls: "border-success/50 bg-success-soft text-success" },
  unverified: { label: "Email unverified", cls: "border-warning/50 bg-warning-soft text-warning" },
  "walk-in": { label: "Walk-in · unlinked", cls: "border-border bg-muted text-muted-foreground" },
  unlinked: { label: "Legacy · unlinked", cls: "border-border bg-muted text-muted-foreground" },
};

function Money({ r }: { r: QueueRow }) {
  if (r.price == null) return <><b className="text-foreground">Pending quotation</b><span className="block text-xs text-muted-foreground">Verified deposit {formatPeso(0)}</span></>;
  return (
    <>
      <b className="text-base text-foreground tabular-nums">{formatPeso(r.price)}</b>
      <span className="block text-xs tabular-nums text-muted-foreground">
        Verified {formatPeso(r.verifiedPaid)}{r.verifiedPaid > 0 ? ` (${r.pct}%)` : ` · 30% due ${formatPeso(r.down)}`} · balance {formatPeso(r.remaining)}
      </span>
      <span className="block text-xs text-muted-foreground">{r.deliveryFee > 0 ? `+ ${formatPeso(r.deliveryFee)} delivery fee` : "Free delivery"}</span>
    </>
  );
}

/** Zone 2: stage filter pills + search + 5-column table (desktop) / stacked list (phones). */
export function OrderQueue({ rows, filters, basePath, openId }: { rows: QueueRow[]; filters: QueueFilter[]; basePath: string; openId?: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState(filters[0]?.key ?? "active");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const f = filters.find((x) => x.key === filter);
    const needle = q.trim().toLowerCase();
    // a search looks through every stage (finding an order by ID should never depend on the active pill)
    if (needle) return rows.filter((r) => `${r.code} ${r.customer} ${r.item}`.toLowerCase().includes(needle));
    return rows.filter((r) => !f || f.statuses.includes(r.status));
  }, [rows, filters, filter, q]);
  const open = (id: string) => router.push(`${basePath}?order=${id}`, { scroll: false });

  return (
    <section aria-labelledby="queue-title" className="grid gap-3" data-testid="order-queue">
      <h2 id="queue-title" className="sr-only">Order queue</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by stage" className="flex min-w-0 flex-wrap gap-1.5">
          {filters.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} data-testid={`filter-${f.key}`}
              className={cn("inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-primary/40 bg-background text-primary hover:bg-accent-soft")}>
              {f.label}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", filter === f.key ? "bg-primary-foreground text-primary" : "bg-secondary text-secondary-foreground")}>{f.count}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order ID, Customer, or Item" data-testid="queue-search"
            className="h-11 w-full rounded-full border border-input bg-background pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25" />
        </label>
      </div>

      {q.trim() && <p className="text-xs text-muted-foreground" aria-live="polite">Searching all stages · {shown.length} match{shown.length === 1 ? "" : "es"}</p>}
      {shown.length === 0 ? (
        <p className="border-y border-dashed border-border py-10 text-center text-sm text-muted-foreground">No orders match this filter. Try another stage or clear the search.</p>
      ) : (<>
        {/* desktop: 5 scannable columns */}
        <div className="hidden overflow-hidden border-y border-border md:block">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Orders — select a row to open its workspace</caption>
            <thead className="bg-secondary text-left text-[13px] font-semibold text-secondary-foreground">
              <tr>
                <th scope="col" className="w-[15%] px-4 py-3">Order &amp; date</th>
                <th scope="col" className="w-[19%] px-4 py-3">Customer</th>
                <th scope="col" className="w-[28%] px-4 py-3">Furniture &amp; dimensions</th>
                <th scope="col" className="w-[16%] px-4 py-3">Status</th>
                <th scope="col" className="w-[22%] px-4 py-3">Quotation &amp; payment</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => open(r.id)} data-testid="queue-row" data-code={r.code}
                  className={cn("cursor-pointer border-t align-top transition-colors hover:bg-accent-soft", openId === r.id && "bg-accent-soft")}>
                  <td className="px-4 py-4">
                    <Link href={`${basePath}?order=${r.id}`} scroll={false} onClick={(e) => e.stopPropagation()} className="font-bold text-foreground underline-offset-4 hover:underline">{r.code}</Link>
                    <span className="block text-xs text-muted-foreground tabular-nums">{formatDate(r.created_at.slice(0, 10))}</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="block font-semibold">{r.customer}</span>
                    <span className={cn("mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold", ACCOUNT[r.account].cls)}>{ACCOUNT[r.account].label}</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="block font-semibold">{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.item}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{r.dims ?? "Dimensions pending"} · {r.material}</span>
                  </td>
                  <td className="px-4 py-4"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-4"><Money r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* phones: flat full-width rows with hairline dividers (no boxed cards) */}
        <ul className="divide-y divide-border border-y border-border md:hidden">
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={`${basePath}?order=${r.id}`} scroll={false} data-testid="queue-card" data-code={r.code}
                className={cn("grid min-w-0 gap-1.5 px-1 py-4 transition-colors hover:bg-accent-soft/60", openId === r.id && "bg-accent-soft")}>
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-foreground">{r.code}</b>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatDate(r.created_at.slice(0, 10))}</span>
                  <ChevronRight className="ml-auto size-5 text-muted-foreground" aria-hidden />
                </span>
                <StatusBadge status={r.status} className="w-fit" />
                <span className="text-sm"><b>{r.customer}</b> <span className={cn("ml-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", ACCOUNT[r.account].cls)}>{ACCOUNT[r.account].label}</span></span>
                <span className="text-sm">{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.item}<span className="block text-xs text-muted-foreground tabular-nums">{r.dims ?? "Dimensions pending"} · {r.material}</span></span>
                <span className="text-sm"><Money r={r} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </>)}
    </section>
  );
}
