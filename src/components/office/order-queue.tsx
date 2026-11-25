"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status";
import { formatDateTime } from "@/lib/domain/dates";
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
  gateMet: boolean;
  need: string;
  thirtyTick: boolean;
  deliveryFee: number;
  pct: number;
  /** "Installment · 3 × ₱6,067 every 15 days · next Dec 10: ₱6,067" or the plan name */
  plan: string | null;
  /** "Verified by Vincris Lelis · Nov 25, 3:10 PM" for the latest verified payment */
  lastVerified: string | null;
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

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Verified share of the furniture price, with a tick at the 30% down payment. */
function PayBar({ r }: { r: QueueRow }) {
  if (r.price == null) return null;
  const pct = Math.max(0, Math.min(100, r.pct));
  const met = r.gateMet;
  return (
    <span className="relative mt-1.5 block h-1.5 w-full max-w-44 rounded-full bg-secondary" aria-hidden title={`${pct}% verified · payment before production ${met ? "met" : "not met"}`}>
      <span className={cn("absolute inset-y-0 left-0 rounded-full", met ? "bg-success" : "bg-warning")} style={{ width: `${Math.max(pct, 2)}%` }} />
      {r.thirtyTick && <span className="absolute -top-0.5 -bottom-0.5 left-[30%] w-px bg-foreground/60" />}
    </span>
  );
}

function Money({ r }: { r: QueueRow }) {
  if (r.price == null) return <><b className="text-foreground">Pending quotation</b><span className="block text-xs text-muted-foreground">Verified deposit {formatPeso(0)}</span></>;
  return (
    <>
      <b className="text-base text-foreground tabular-nums">{formatPeso(r.price)}</b>
      <span className="block text-xs tabular-nums text-muted-foreground">
        Verified {formatPeso(r.verifiedPaid)}{r.verifiedPaid > 0 ? ` (${r.pct}%)` : ` · ${r.need}${r.down > 0 ? ` ${formatPeso(r.down)}` : ""}`} · balance {formatPeso(r.remaining)}
      </span>
      <PayBar r={r} />
      {r.plan && <span className="mt-1 block text-xs font-semibold text-foreground" data-testid="queue-plan">{r.plan}</span>}
      {r.lastVerified && <span className="mt-1 block text-xs text-success" data-testid="queue-verified-by">{r.lastVerified}</span>}
      <span className="mt-1 block text-xs text-muted-foreground">{r.deliveryFee > 0 ? `+ ${formatPeso(r.deliveryFee)} delivery fee` : "Free delivery"}</span>
    </>
  );
}

/** Zone 2: stage filters (segmented) + search + table (desktop) / compact cards (phones). */
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
    <section aria-labelledby="queue-title" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-testid="order-queue">
      <h2 id="queue-title" className="sr-only">Order queue</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {/* segmented stage control: one muted track, the active stage raised */}
        <div role="group" aria-label="Filter by stage" className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-xl bg-muted/70 p-1 lg:w-auto">
          {filters.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} data-testid={`filter-${f.key}`}
              className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-colors sm:text-sm",
                filter === f.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {f.label}
              <span className={cn("rounded-full px-1.5 text-[11px] font-bold tabular-nums", filter === f.key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>{f.count}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order ID, Customer, or Item" data-testid="queue-search"
            className="h-10 w-full rounded-xl border border-input bg-card pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25" />
        </label>
      </div>

      {q.trim() && <p className="text-xs text-muted-foreground" aria-live="polite">Searching all stages · {shown.length} match{shown.length === 1 ? "" : "es"}</p>}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No orders match this filter. Try another stage or clear the search.</p>
      ) : (<>
        {/* desktop: 5 scannable columns */}
        <div className="hidden overflow-hidden rounded-xl border border-border md:block">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Orders — select a row to open its workspace</caption>
            <thead className="bg-muted/60 text-left text-xs font-semibold text-muted-foreground">
              <tr>
                <th scope="col" className="w-[15%] px-4 py-2.5">Order &amp; date</th>
                <th scope="col" className="w-[20%] px-4 py-2.5">Customer</th>
                <th scope="col" className="w-[27%] px-4 py-2.5">Furniture &amp; dimensions</th>
                <th scope="col" className="w-[15%] px-4 py-2.5">Status</th>
                <th scope="col" className="w-[23%] px-4 py-2.5">Quotation &amp; payment</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => open(r.id)} data-testid="queue-row" data-code={r.code}
                  className={cn("cursor-pointer border-t border-border align-top transition-colors hover:bg-accent-soft/60", openId === r.id && "bg-accent-soft")}>
                  <td className="px-4 py-3.5">
                    <Link href={`${basePath}?order=${r.id}`} scroll={false} onClick={(e) => e.stopPropagation()} className="font-bold text-foreground underline-offset-4 hover:underline">{r.code}</Link>
                    <span className="block text-xs text-muted-foreground tabular-nums">{formatDateTime(r.created_at)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground" aria-hidden>{initials(r.customer)}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{r.customer}</span>
                        <span className={cn("mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold", ACCOUNT[r.account].cls)}>{ACCOUNT[r.account].label}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="block font-semibold">{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.item}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{r.dims ?? "Dimensions pending"} · {r.material}</span>
                  </td>
                  <td className="px-4 py-3.5"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3.5"><Money r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* phones: compact cards */}
        <ul className="grid gap-2 md:hidden">
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={`${basePath}?order=${r.id}`} scroll={false} data-testid="queue-card" data-code={r.code}
                className={cn("grid min-w-0 gap-1.5 rounded-xl border border-border bg-muted/30 p-3 transition-colors hover:bg-accent-soft/60", openId === r.id && "bg-accent-soft")}>
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-sm text-foreground">{r.code}</b>
                  <StatusBadge status={r.status} className="w-fit" />
                  <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
                </span>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground" aria-hidden>{initials(r.customer)}</span>
                  <b className="truncate">{r.customer}</b>
                  <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", ACCOUNT[r.account].cls)}>{ACCOUNT[r.account].label}</span>
                </span>
                <span className="text-xs">{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.item}<span className="block text-[11px] text-muted-foreground tabular-nums">{r.dims ?? "Dimensions pending"} · {r.material} · {formatDateTime(r.created_at)}</span></span>
                <span className="text-xs"><Money r={r} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </>)}
    </section>
  );
}
