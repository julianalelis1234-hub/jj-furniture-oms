// Workshop parts list: the pieces of the 3D model with their finished sizes, grouped.
// It comes from the same parametric parts as the 3D view, so it always matches the
// approved W × H × D and the design's details. It is a guide for cutting, not a
// shop drawing: joinery allowances (tenons, overlaps) are added by the craftsman.
import type { FurnitureCategory } from "./furniture";
import { buildFurnitureParts, type MatKey } from "./furniture3d";

export interface CutRow {
  name: string;
  /** pieces per one item */
  qty: number;
  /** "120 × 45 × 2.5 cm" (length × width × thickness) or "Ø 5 × 70 cm" */
  size: string;
  kind: "Wood" | "Hardware" | "Glass" | "Upholstery";
}

const half = (n: number) => Math.round(n * 2) / 2;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const KIND: Record<MatKey, CutRow["kind"]> = { wood: "Wood", woodDeep: "Wood", brass: "Hardware", glass: "Glass", linen: "Upholstery" };

export function cutList(spec: {
  furniture_category: FurnitureCategory | null;
  design_variant: string | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
}): CutRow[] {
  const { furniture_category: cat, design_variant: v, width_cm: w, height_cm: h, depth_cm: d } = spec;
  if (!cat || !v || w == null || h == null || d == null) return [];
  const rows = new Map<string, CutRow>();
  for (const p of buildFurnitureParts(cat, v, { w, h, d })) {
    let size: string;
    if (p.shape === "box") {
      const [a, b, c] = [0, 1, 2].map((i) => half(p.max[i] - p.min[i])).sort((x, y) => y - x);
      size = `${fmt(a)} × ${fmt(b)} × ${fmt(c)} cm`;
    } else if (p.shape === "cyl") {
      const dia = half(2 * Math.max(p.rTop, p.rBottom) * Math.max(p.sx ?? 1, p.sz ?? 1));
      size = `Ø ${fmt(dia)} × ${fmt(half(p.h))} cm${p.rTop !== p.rBottom ? " (tapered)" : ""}`;
    } else {
      size = `Ø ${fmt(half(2 * p.r))} × ${fmt(half(p.len))} cm${p.half ? " (half round)" : ""}`;
    }
    const name = p.name ?? "Frame piece";
    const kind = KIND[p.mat];
    const key = `${kind}|${name}|${size}`;
    const row = rows.get(key);
    if (row) row.qty++;
    else rows.set(key, { name, qty: 1, size, kind });
  }
  const order: CutRow["kind"][] = ["Wood", "Glass", "Upholstery", "Hardware"];
  return [...rows.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name) || b.qty - a.qty);
}
