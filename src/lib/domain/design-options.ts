import { CATALOG, type FurnitureCategory } from "./furniture";

/**
 * Per-piece details (drawers, shelves, doors, leg style).
 *
 * They are written into the design text after the design's name, e.g.
 *   "Chest of Drawers · 6 drawers · tapered legs"
 * so they travel through the existing specification revisions, quotation
 * approval, diffs ("Design: … -> …") and the workshop card without a new
 * database column. Only choices that differ from the design's default are
 * written, so an untouched design keeps its plain name.
 */
export type LegStyle = "straight" | "tapered";
export const LEG_STYLES: readonly LegStyle[] = ["straight", "tapered"];

export interface DesignOptions {
  drawers?: number;
  shelves?: number;
  doors?: number;
  legs?: LegStyle;
}
export type CountKey = "drawers" | "shelves" | "doors";
export const COUNT_KEYS: readonly CountKey[] = ["drawers", "shelves", "doors"];

/** min, max and default for a count; a null default means "fitted to the size". */
export interface CountRule { min: number; max: number; def: number | null }
export interface OptionRules { drawers?: CountRule; shelves?: CountRule; doors?: CountRule; legs?: { def: LegStyle } }

const R = (min: number, max: number, def: number | null): CountRule => ({ min, max, def });

/** Which details each design offers. Designs not listed have none. */
export const OPTION_RULES: Partial<Record<FurnitureCategory, Record<string, OptionRules>>> = {
  "Dining Table": {
    "4-Seater Rectangular": { legs: { def: "tapered" } },
    "6-Seater Classic": { legs: { def: "tapered" } },
    "8-Seater Banquet": { legs: { def: "tapered" } },
  },
  "Kitchen / Wall Cabinet": {
    "2-Door Overhead": { doors: R(1, 4, 2) },
    "3-Door Base Counter": { doors: R(2, 5, 3), drawers: R(0, 5, 0) },
  },
  Chair: {
    "Slatted Dining Chair": { legs: { def: "tapered" } },
    Armchair: { legs: { def: "straight" } },
  },
  Bench: {
    "Plain Bench": { legs: { def: "straight" } },
    "Backrest Bench": { legs: { def: "straight" } },
  },
  "TV Stand / Console": {
    "Low TV Stand": { doors: R(0, 4, 2), drawers: R(0, 4, 0), shelves: R(0, 2, 1) },
    "Console Table": { drawers: R(0, 3, 2), shelves: R(0, 1, 1), legs: { def: "tapered" } },
  },
  "Altar Table": {
    "Classic Altar Table": { drawers: R(0, 4, 2), legs: { def: "straight" } },
    "Two-Tier Altar": { drawers: R(0, 4, 2), legs: { def: "straight" } },
  },
  "Study Desk": {
    "Simple Study Desk": { drawers: R(0, 2, 1), legs: { def: "tapered" } },
    "Desk with Drawer Pedestal": { drawers: R(1, 5, 3) },
  },
  "Drawer Cabinet": {
    "Chest of Drawers": { drawers: R(2, 8, 5), legs: { def: "straight" } },
    "Bedside Table": { drawers: R(1, 3, 2), legs: { def: "tapered" } },
    Dresser: { drawers: R(2, 6, 3), legs: { def: "straight" } },
  },
  "Custom Piece": {
    "Wardrobe / Aparador": { doors: R(2, 4, 2), drawers: R(0, 3, 0) },
    "Bookshelf / Divider": { shelves: R(1, 8, null) },
  },
};

export const optionRules = (category: FurnitureCategory | null | undefined, base: string | null | undefined): OptionRules =>
  (category && base && OPTION_RULES[category]?.[base]) || {};

const NOUN: Record<CountKey, [string, string]> = { drawers: ["drawer", "drawers"], shelves: ["shelf", "shelves"], doors: ["door", "doors"] };
export const countLabel = (k: CountKey, n: number) => `${n} ${NOUN[k][n === 1 ? 0 : 1]}`;

/** "Chest of Drawers · 6 drawers · tapered legs" -> base + options (unknown pieces are returned in `unknown`). */
export function splitVariant(variant: string | null | undefined): { base: string; options: DesignOptions; unknown: string[] } {
  const [head, ...rest] = (variant ?? "").split(" · ").map((s) => s.trim());
  const options: DesignOptions = {};
  const unknown: string[] = [];
  for (const piece of rest) {
    const m = /^(\d{1,2}) (drawers?|shel(?:f|ves)|doors?)$/i.exec(piece);
    const l = /^(straight|tapered) legs$/i.exec(piece);
    if (m) {
      const word = m[2].toLowerCase();
      const key: CountKey = word.startsWith("drawer") ? "drawers" : word.startsWith("shel") ? "shelves" : "doors";
      options[key] = Number(m[1]);
    } else if (l) options.legs = l[1].toLowerCase() as LegStyle;
    else if (piece) unknown.push(piece);
  }
  return { base: head ?? "", options, unknown };
}

/** The design text for a base design and its options: only non-default choices are written. */
export function composeVariant(category: FurnitureCategory | null | undefined, base: string, options: DesignOptions): string {
  const rules = optionRules(category, base);
  const out = [base];
  for (const k of COUNT_KEYS) {
    const r = rules[k];
    const v = options[k];
    if (r && v != null && v !== r.def) out.push(countLabel(k, v));
  }
  if (rules.legs && options.legs && options.legs !== rules.legs.def) out.push(`${options.legs} legs`);
  return out.join(" · ");
}

/** The options actually in effect (defaults filled in), for the 3D model and the parts list. */
export function effectiveOptions(category: FurnitureCategory | null | undefined, variant: string | null | undefined) {
  const { base, options } = splitVariant(variant);
  const rules = optionRules(category, base);
  const pick = (k: CountKey) => {
    const r = rules[k];
    if (!r) return undefined;
    const v = options[k] ?? r.def;
    return v == null ? null : Math.min(r.max, Math.max(r.min, v));
  };
  return {
    base,
    drawers: pick("drawers"),
    shelves: pick("shelves"),
    doors: pick("doors"),
    legs: rules.legs ? (options.legs ?? rules.legs.def) : undefined,
  };
}

/** Problems with a design text (unknown base, unknown or out-of-range details); empty when valid. */
export function variantProblems(category: FurnitureCategory, variant: string): string[] {
  const { base, options, unknown } = splitVariant(variant);
  const problems: string[] = [];
  if (!CATALOG[category]?.variants.includes(base)) problems.push(`Choose a ${category} design.`);
  const rules = optionRules(category, base);
  for (const u of unknown) problems.push(`"${u}" is not an option for this design.`);
  for (const k of COUNT_KEYS) {
    const v = options[k];
    if (v == null) continue;
    const r = rules[k];
    if (!r) problems.push(`This design has no ${NOUN[k][1]} option.`);
    else if (v < r.min || v > r.max) problems.push(`${base}: ${NOUN[k][1]} must be ${r.min} to ${r.max}.`);
  }
  if (options.legs && !rules.legs) problems.push("This design has no leg style option.");
  return problems;
}
