import { ListChecks } from "lucide-react";
import { cutList } from "@/lib/domain/cut-list";
import type { FurnitureCategory } from "@/lib/domain/furniture";

/** Collapsible workshop parts list (finished sizes per piece), for the craftsman and the office. */
export function PartsList({ spec, quantity = 1, woodLabel, className }: {
  spec: { furniture_category: FurnitureCategory | null; design_variant: string | null; width_cm: number | null; height_cm: number | null; depth_cm: number | null };
  quantity?: number;
  woodLabel?: string;
  className?: string;
}) {
  const rows = cutList(spec);
  if (!rows.length) return null;
  const pieces = rows.filter((r) => r.kind === "Wood").reduce((s, r) => s + r.qty, 0);
  return (
    <details className={className} data-testid="parts-list">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
        <ListChecks className="size-4" aria-hidden /> Parts list · {pieces} wood pieces{quantity > 1 ? ` per item (× ${quantity})` : ""}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="pb-1 text-left text-xs text-muted-foreground">
            Finished sizes from the approved design{woodLabel ? ` · ${woodLabel}` : ""}. Add joinery allowance when cutting; check against the order before cutting.
          </caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-semibold">Piece</th>
              <th className="py-1 pr-2 text-right font-semibold">Qty</th>
              <th className="py-1 font-semibold">Size (L × W × T)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.name}-${r.size}`} className="border-b border-border/60 last:border-0">
                <td className="py-1 pr-2">{r.name}{r.kind !== "Wood" && <span className="text-xs text-muted-foreground"> · {r.kind.toLowerCase()}</span>}</td>
                <td className="py-1 pr-2 text-right font-semibold tabular-nums">{r.qty * quantity}</td>
                <td className="py-1 tabular-nums">{r.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
