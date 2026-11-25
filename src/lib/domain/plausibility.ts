import type { FurnitureCategory } from "./furniture";

/**
 * Typical size ranges (cm) per category / design, used only for a NON-BLOCKING
 * feasibility hint. Entered values are never changed, clamped or saved
 * differently because of these ranges — staff/owner verify feasibility.
 */
type Range = [min: number, max: number];
interface SizeRange { w: Range; h: Range; d: Range }

const RANGES: Record<FurnitureCategory, { default: SizeRange; variants?: Record<string, Partial<SizeRange>> }> = {
  "Panel Door": { default: { w: [55, 130], h: [175, 260], d: [2.5, 8] } },
  "Dining Table": {
    default: { w: [80, 300], h: [65, 85], d: [65, 130] },
    variants: {
      "4-Seater Rectangular": { w: [90, 160], d: [65, 100] },
      "6-Seater Classic": { w: [140, 230], d: [75, 110] },
      "8-Seater Banquet": { w: [190, 320], d: [85, 130] },
      "Round Pedestal": { w: [75, 160], d: [75, 160] },
    },
  },
  "Living Room Set": {
    default: { w: [110, 360], h: [60, 115], d: [55, 110] },
    variants: { "L-Shape Corner Frame": { w: [160, 360], d: [70, 240] } },
  },
  "Kitchen / Wall Cabinet": {
    default: { w: [35, 320], h: [30, 240], d: [20, 75] },
    variants: {
      "2-Door Overhead": { w: [35, 200], h: [30, 110], d: [20, 50] },
      "3-Door Base Counter": { w: [70, 320], h: [70, 100], d: [40, 75] },
      "Glass-Front Display Hutch": { w: [50, 220], h: [75, 230], d: [25, 65] },
    },
  },
  Chair: {
    default: { w: [38, 80], h: [70, 115], d: [40, 70] },
    variants: { "Rocking Chair": { w: [50, 80], h: [85, 120], d: [70, 110] }, Armchair: { w: [55, 95], h: [70, 110], d: [55, 90] } },
  },
  Bench: {
    default: { w: [60, 260], h: [38, 55], d: [25, 50] },
    variants: { "Backrest Bench": { h: [70, 100], d: [45, 70] } },
  },
  "TV Stand / Console": {
    default: { w: [80, 260], h: [35, 70], d: [30, 55] },
    variants: { "Console Table": { w: [60, 180], h: [70, 90], d: [25, 45] } },
  },
  "Altar Table": { default: { w: [60, 200], h: [75, 130], d: [30, 60] } },
  "Study Desk": { default: { w: [70, 200], h: [70, 80], d: [45, 80] } },
  Headboard: { default: { w: [90, 220], h: [60, 160], d: [3, 15] } },
  "Drawer Cabinet": {
    default: { w: [40, 200], h: [45, 150], d: [30, 60] },
    variants: {
      "Chest of Drawers": { w: [50, 120], h: [75, 150] },
      "Bedside Table": { w: [35, 70], h: [45, 75], d: [30, 50] },
      Dresser: { w: [80, 200], h: [70, 100] },
    },
  },
  "Custom Piece": {
    default: { w: [30, 300], h: [30, 260], d: [20, 240] },
    variants: {
      "Bed Frame": { w: [85, 210], h: [30, 160], d: [180, 235] },
      "Wardrobe / Aparador": { w: [55, 260], h: [140, 250], d: [40, 75] },
      "Bookshelf / Divider": { w: [35, 260], h: [50, 250], d: [18, 65] },
    },
  },
};

export function sizeRangeFor(category: FurnitureCategory, variant: string | null): SizeRange {
  const c = RANGES[category];
  const base = variant?.split(" · ")[0];
  return { ...c.default, ...(base ? c.variants?.[base] : undefined) };
}

export interface PlausibilityResult {
  status: "ok" | "compact" | "large" | "mixed";
  axes: { axis: "Width" | "Height" | "Depth"; value: number; range: Range; side: "compact" | "large" }[];
  message: string | null;
}

/**
 * Non-blocking check. Returns a message when any entered dimension is outside
 * the typical range for the selected design. Missing dimensions are not
 * judged here (they render as "Dimensions Pending Clarification").
 */
export function checkPlausibility(spec: {
  furniture_category: FurnitureCategory | null;
  design_variant: string | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
}): PlausibilityResult {
  const { furniture_category: cat, design_variant: variant, width_cm: w, height_cm: h, depth_cm: d } = spec;
  if (!cat || w == null || h == null || d == null) return { status: "ok", axes: [], message: null };
  const r = sizeRangeFor(cat, variant);
  const axes: PlausibilityResult["axes"] = [];
  for (const [axis, value, range] of [["Width", w, r.w], ["Height", h, r.h], ["Depth", d, r.d]] as const) {
    if (value < range[0]) axes.push({ axis, value, range, side: "compact" });
    else if (value > range[1]) axes.push({ axis, value, range, side: "large" });
  }
  if (axes.length === 0) return { status: "ok", axes, message: null };
  const sides = new Set(axes.map((a) => a.side));
  const status = sides.size > 1 ? "mixed" : axes[0].side;
  const word = status === "mixed" ? "unusual" : status === "compact" ? "unusually compact" : "unusually large";
  const detail = axes.map((a) => `${a.axis} ${a.value} cm (typical ${a.range[0]}–${a.range[1]} cm)`).join("; ");
  return {
    status,
    axes,
    message: `Entered dimensions are ${word} for a ${variant ?? cat} — Staff/Owner will verify structural feasibility. ${detail}.`,
  };
}
