import { AlertTriangle, Layers } from "lucide-react";
import { Metric } from "@/components/office/office-workspace";
import { AddLumberItemDialog, RecordLumberDialog, ReorderLevelEditor } from "@/components/owner/inventory-controls";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { formatDateTime } from "@/lib/domain/dates";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext, nameOf } from "@/lib/server/office-data";
import { inventorySummary, type StockLevel } from "@/lib/services/inventory";
import { cn } from "@/lib/utils";

export const metadata = { title: "Lumber & Inventory" };

const LEVEL: Record<StockLevel, { label: string; className: string }> = {
  ok: { label: "In stock", className: "bg-success-soft text-success" },
  low: { label: "Low · reorder", className: "bg-warning-soft text-warning" },
  out: { label: "Out of stock", className: "bg-destructive/10 text-destructive" },
};
const bf = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

/** Lumber & Inventory: board feet on hand per timber, reorder alerts, and the receive / use / adjust ledger. */
export default async function OwnerInventory() {
  const actor = await requireActor(["owner"]);
  const { data, lumberItems, lumberMovements, badges } = await loadOwnerContext(await getStore());
  const inv = inventorySummary(lumberItems, lumberMovements);
  const items = [...inv.items].sort((a, b) => ({ out: 0, low: 1, ok: 2 })[a.level] - ({ out: 0, low: 1, ok: 2 })[b.level] || a.wood_name.localeCompare(b.wood_name));
  const itemName = new Map(lumberItems.map((i) => [i.id, `${i.wood_name}${i.size_note ? ` ${i.size_note}` : ""}`]));
  const orderCode = new Map(data.orders.map((o) => [o.id, o.order_code]));
  // one scale for every stock bar: the largest of on-hand and reorder level across items
  const scale = Math.max(1, ...items.map((i) => Math.max(i.on_hand_bf, i.reorder_level_bf)));
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Lumber & Inventory" description="Board feet on hand for every timber the shop stocks. Stock changes only through receive, use and adjust entries."
        actions={<AddLumberItemDialog />} />

      <div className="mb-10 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Metric testid="inv-on-hand" label="On hand" value={`${bf(inv.totalOnHandBf)} bf`} sub={`${inv.items.length} kinds of lumber`} icon={<Layers />} />
        <Metric testid="inv-low" label="To reorder" value={inv.lowStock.length} sub="at or below the reorder level" icon={<AlertTriangle />} tone={inv.lowStock.length ? "warning" : undefined} />
        <Metric testid="inv-received" label="Received · 30 days" value={`${bf(inv.received30)} bf`} sub="deliveries from suppliers" icon={<Layers />} />
        <Metric testid="inv-used" label="Used · 30 days" value={`${bf(inv.used30)} bf`} sub="taken for workshop jobs" icon={<Layers />} />
      </div>

      <section aria-labelledby="stock-title" className="mb-10">
        <h2 id="stock-title" className="mb-1 text-2xl">Stock</h2>
        <p className="mb-3 text-sm text-muted-foreground">The bar shows board feet on hand; the tick is the reorder level.</p>
        <RowList data-testid="stock-list">
          {items.map((i) => (
            <li key={i.id} className="grid gap-3 px-1 py-4 sm:px-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] lg:items-center" data-testid="stock-row" data-level={i.level}>
              <span className="min-w-0">
                <b className="block">{i.wood_name}</b>
                <span className="text-sm text-muted-foreground">{i.size_note ?? "any size"}{i.wood_type === "Other" ? "" : ` · ${i.wood_type}`}</span>
              </span>
              <span className="grid gap-1.5">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <b className="text-xl tabular-nums">{bf(i.on_hand_bf)} <span className="text-sm font-semibold text-muted-foreground">bf</span></b>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", LEVEL[i.level].className)}>{LEVEL[i.level].label}</span>
                </span>
                {/* single-hue magnitude bar with the reorder level as a tick; the numbers stay in text beside it */}
                <span className="relative h-2.5 w-full max-w-md rounded-full bg-secondary" title={`${bf(i.on_hand_bf)} bf on hand · reorder at ${bf(i.reorder_level_bf)} bf`} aria-hidden>
                  <span className={cn("absolute inset-y-0 left-0 rounded-full", i.level === "ok" ? "bg-primary" : i.level === "low" ? "bg-warning" : "bg-destructive")}
                    style={{ width: `${Math.min(100, (i.on_hand_bf / scale) * 100)}%` }} />
                  <span className="absolute -top-1 -bottom-1 w-0.5 rounded bg-foreground" style={{ left: `${Math.min(100, (i.reorder_level_bf / scale) * 100)}%` }} />
                </span>
                <ReorderLevelEditor item={i} />
              </span>
              <span className="flex flex-wrap gap-2">
                <RecordLumberDialog item={i} kind="receive" />
                <RecordLumberDialog item={i} kind="use" />
                <RecordLumberDialog item={i} kind="adjust" />
              </span>
            </li>
          ))}
        </RowList>
      </section>

      <section aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="mb-3 text-2xl">Recent entries</h2>
        <RowList data-testid="lumber-ledger">
          {lumberMovements.slice(0, 25).map((m) => (
            <li key={m.id} className="grid gap-1 px-1 py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-3">
              <span className="text-muted-foreground tabular-nums">{formatDateTime(m.created_at)}</span>
              <span className="min-w-0">
                <b>{itemName.get(m.item_id) ?? "—"}</b>
                <span className="text-muted-foreground"> · {nameOf(data.profiles, m.recorded_by)}{m.order_id ? ` · for ${orderCode.get(m.order_id) ?? "an order"}` : ""}{m.note ? ` · ${m.note}` : ""}</span>
              </span>
              <b className={cn("tabular-nums", m.kind === "use" || m.board_feet < 0 ? "text-destructive" : "text-success")}>
                {m.kind === "use" ? "−" : m.board_feet < 0 ? "−" : "+"}{bf(Math.abs(m.board_feet))} bf <span className="text-xs font-semibold text-muted-foreground">{m.kind}</span>
              </b>
            </li>
          ))}
        </RowList>
      </section>
    </OwnerShell>
  );
}
