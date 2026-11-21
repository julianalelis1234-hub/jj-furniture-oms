// Furniture configurator catalog and specification helpers (shared by staff
// intake, customer portal, workshop cards and the server).
import type { WoodType } from "./types";

export const FURNITURE_CATEGORIES = [
  "Panel Door",
  "Dining Table",
  "Living Room Set",
  "Kitchen / Wall Cabinet",
  "Custom Piece",
] as const;
export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];

export interface Dims {
  width_cm: number;
  height_cm: number;
  depth_cm: number;
}

export const CATALOG: Record<FurnitureCategory, { variants: string[]; presets: Dims[]; blurb: string }> = {
  "Panel Door": {
    variants: ["Classic 2-Panel", "Modern 4-Panel", "Arch-Top Single Panel", "Glass-Inset Half Panel"],
    presets: [
      { width_cm: 80, height_cm: 210, depth_cm: 4.5 },
      { width_cm: 90, height_cm: 210, depth_cm: 4.5 },
      { width_cm: 100, height_cm: 210, depth_cm: 5 },
    ],
    blurb: "Solid-wood interior and main doors",
  },
  "Dining Table": {
    variants: ["4-Seater Rectangular", "6-Seater Classic", "8-Seater Banquet", "Round Pedestal"],
    presets: [
      { width_cm: 120, height_cm: 76, depth_cm: 80 },
      { width_cm: 180, height_cm: 76, depth_cm: 90 },
      { width_cm: 220, height_cm: 76, depth_cm: 100 },
    ],
    blurb: "Family tables, from 4 to 8 seats",
  },
  "Living Room Set": {
    variants: ["3-1-1 Slatted Wooden Set", "L-Shape Corner Frame", "Classic Curved Armrest Set"],
    presets: [{ width_cm: 180, height_cm: 85, depth_cm: 75 }],
    blurb: "Sala sets with wooden frames",
  },
  "Kitchen / Wall Cabinet": {
    variants: ["2-Door Overhead", "3-Door Base Counter", "Glass-Front Display Hutch"],
    presets: [
      { width_cm: 120, height_cm: 70, depth_cm: 35 },
      { width_cm: 150, height_cm: 85, depth_cm: 55 },
    ],
    blurb: "Overhead, base and display cabinets",
  },
  "Custom Piece": {
    variants: ["Bed Frame", "Wardrobe / Aparador", "Bookshelf / Divider"],
    presets: [],
    blurb: "Beds, aparador and shelving made to size",
  },
};

export const FINISHES = ["Natural Varnish", "Walnut Stain", "Gloss White", "Dark Espresso"] as const;
export type Finish = (typeof FINISHES)[number];

export const WOOD_INFO: Record<WoodType, { label: string; note: string }> = {
  Mahogany: { label: "Mahogany", note: "Rich reddish-amber hardwood" },
  Gmelina: { label: "Gmelina", note: "Light golden-cream timber" },
  Other: { label: "Other wood", note: "Describe the wood below" },
};

/** The authoritative, structured specification of one order revision. */
export interface FurnitureSpec {
  furniture_category: FurnitureCategory | null;
  design_variant: string | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  wood_type: WoodType;
  custom_wood_note: string | null;
  color_finish: string;
  quantity: number;
}

export const SPEC_FIELDS = [
  "furniture_category",
  "design_variant",
  "width_cm",
  "height_cm",
  "depth_cm",
  "wood_type",
  "custom_wood_note",
  "color_finish",
  "quantity",
] as const;

export const FIELD_LABEL: Record<string, string> = {
  furniture_category: "Category",
  design_variant: "Design",
  width_cm: "Width",
  height_cm: "Height",
  depth_cm: "Depth",
  wood_type: "Wood",
  custom_wood_note: "Wood note",
  color_finish: "Finish",
  quantity: "Quantity",
  quoted_furniture_price: "Price",
  quoted_delivery_fee: "Delivery fee",
};

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function formatDims(d: { width_cm: number | null; height_cm: number | null; depth_cm: number | null }): string | null {
  if (d.width_cm == null || d.height_cm == null || d.depth_cm == null) return null;
  return `${fmtNum(d.width_cm)} × ${fmtNum(d.height_cm)} × ${fmtNum(d.depth_cm)} cm`;
}

/** Same text the database writes into orders.dimensions (see add_spec_revision). */
export function dimensionsText(d: Dims): string {
  return `${d.width_cm.toFixed(1)} × ${d.height_cm.toFixed(1)} × ${d.depth_cm.toFixed(1)} cm (W × H × D)`;
}

export function itemNameFor(spec: Pick<FurnitureSpec, "furniture_category" | "design_variant">): string {
  if (!spec.furniture_category || !spec.design_variant) return "Custom furniture";
  if (spec.furniture_category === "Custom Piece") return spec.design_variant;
  const noun: Record<FurnitureCategory, string> = {
    "Panel Door": "Panel Door",
    "Dining Table": "Dining Table",
    "Living Room Set": "Sala Set",
    "Kitchen / Wall Cabinet": "Cabinet",
    "Custom Piece": "",
  };
  return `${spec.design_variant} ${noun[spec.furniture_category]}`.trim();
}

export function normalizeSpec(s: FurnitureSpec): FurnitureSpec {
  const note = s.wood_type === "Other" ? (s.custom_wood_note ?? "").trim() || null : null;
  const num = (v: number | null) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
  return {
    furniture_category: s.furniture_category,
    design_variant: s.design_variant?.trim() || null,
    width_cm: num(s.width_cm),
    height_cm: num(s.height_cm),
    depth_cm: num(s.depth_cm),
    wood_type: s.wood_type,
    custom_wood_note: note,
    color_finish: s.color_finish.trim(),
    quantity: Number(s.quantity) || 1,
  };
}

export type SpecDiff = Record<string, { from: unknown; to: unknown }>;

export function diffSpecs(from: Partial<Record<string, unknown>>, to: Partial<Record<string, unknown>>): SpecDiff {
  const out: SpecDiff = {};
  for (const k of Object.keys(to)) {
    const a = from[k] ?? null;
    const b = to[k] ?? null;
    const same = typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) && a !== null && b !== null : a === b;
    if (!same && !(a === null && b === null)) out[k] = { from: a, to: b };
  }
  return out;
}

const fmtVal = (k: string, v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (k.endsWith("_cm")) return `${fmtNum(Number(v))}cm`;
  if (k.startsWith("quoted_")) return `₱${Number(v).toLocaleString("en-PH")}`;
  return String(v);
};

/** "Wood: Gmelina -> Mahogany; Width: 180cm -> 220cm" */
export function describeDiff(diff: SpecDiff): string {
  return Object.entries(diff)
    .map(([k, { from, to }]) => `${FIELD_LABEL[k] ?? k}: ${fmtVal(k, from)} -> ${fmtVal(k, to)}`)
    .join("; ");
}

export function isConfiguratorFinish(f: string): f is Finish {
  return (FINISHES as readonly string[]).includes(f);
}
