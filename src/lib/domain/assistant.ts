// Customization assistant: turns a plain description ("6 seater narra dining table,
// 2 meters long, dark finish") into configurator choices. Rule-based and local:
// no text leaves the browser and nothing is invented. Whatever it cannot read is
// reported back so the customer can pick it by hand.
import { CATALOG, FINISHES, type FurnitureCategory } from "./furniture";
import type { WoodType } from "./types";

export interface AssistantPatch {
  furniture_category?: FurnitureCategory;
  design_variant?: string;
  width_cm?: string;
  height_cm?: string;
  depth_cm?: string;
  wood_type?: WoodType;
  custom_wood_note?: string;
  color_finish?: string;
  quantity?: string;
}

export interface ReferencePhoto {
  src: string;
  alt: string;
  caption: string;
}

export interface AssistantResult {
  patch: AssistantPatch;
  /** one line per understood item, in plain words ("Wood: Narra (other wood)") */
  understood: string[];
  /** things the customer mentioned that need a person (price, delivery date, ...) */
  notes: string[];
  photo: ReferencePhoto | null;
}

/** The shop's own photo library. Only real photos and labelled 3D renders, never stock images. */
export const PHOTO_LIBRARY: (ReferencePhoto & { category: FurnitureCategory; variants?: string[] })[] = [
  { category: "Panel Door", src: "/samples/carved-door.jpg", alt: "Solid wood door with a hand-carved S-curve panel and a high-gloss dark stain", caption: "Carved panel door made by JJ Enterprises" },
  { category: "Dining Table", src: "/samples/dining-set-10-seater.jpg", alt: "Solid wood slab dining table with ten high-back slatted chairs, natural finish", caption: "10-seater dining set made by JJ Enterprises" },
  { category: "Living Room Set", src: "/samples/sala-set-3d.jpg", alt: "3D preview of a Mahogany sala set in walnut stain", caption: "Sala set · 3D preview (shop photo coming soon)" },
];

/** Checked in this order: specific pieces first, so "cabinet with glass doors" is a cabinet, not a door. */
const CATEGORY_WORDS: [RegExp, FurnitureCategory, string?][] = [
  [/\b(bed|kama|katre|bedframe)\b/, "Custom Piece", "Bed Frame"],
  [/\b(wardrobe|aparador|closet|armoire)\b/, "Custom Piece", "Wardrobe / Aparador"],
  [/\b(bookshelf|book\s*shelf|shelf|shelves|divider|estante)\b/, "Custom Piece", "Bookshelf / Divider"],
  [/\b(kitchen|cabinet|cupboard|counter|hutch|overhead|paminggalan)\b/, "Kitchen / Wall Cabinet"],
  [/\b(sala|sofa|couch|living\s*room|lounge|loveseat)\b/, "Living Room Set"],
  [/\b(dining|mesa|lamesa|kainan|table)\b/, "Dining Table"],
  [/\b(door|pinto|pintuan)\b/, "Panel Door"],
];

/** Specific design words, checked inside the matched category. */
const VARIANT_WORDS: Record<FurnitureCategory, [RegExp, string][]> = {
  "Panel Door": [[/\barch/, "Arch-Top Single Panel"], [/\bglass/, "Glass-Inset Half Panel"], [/\b(4|four)[\s-]*panel|modern/, "Modern 4-Panel"], [/\b(2|two)[\s-]*panel|classic/, "Classic 2-Panel"]],
  "Dining Table": [[/\bround|pedestal|bilog/, "Round Pedestal"]],
  "Living Room Set": [[/\bl[\s-]*shape|corner/, "L-Shape Corner Frame"], [/\bcurved|armrest|classic/, "Classic Curved Armrest Set"], [/\bslat|3[\s-]*1[\s-]*1/, "3-1-1 Slatted Wooden Set"]],
  "Kitchen / Wall Cabinet": [[/\bglass|display|hutch/, "Glass-Front Display Hutch"], [/\boverhead|wall|hanging/, "2-Door Overhead"], [/\bbase|counter|3[\s-]*door/, "3-Door Base Counter"]],
  "Custom Piece": [],
};

const OTHER_WOODS = ["narra", "acacia", "molave", "yakal", "kamagong", "tanguile", "lauan", "apitong", "teak", "pine", "mango"];
const FINISH_WORDS: [RegExp, (typeof FINISHES)[number]][] = [
  [/\b(white|puti|gloss\s*white|glossy\s*white)\b/, "Gloss White"],
  [/\b(espresso|dark|black|itim|dark\s*brown|chocolate)\b/, "Dark Espresso"],
  [/\b(walnut|brown|medium\s*stain|stained)\b/, "Walnut Stain"],
  [/\b(natural|varnish|clear|light|plain)\b/, "Natural Varnish"],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12, isa: 1, dalawa: 2, tatlo: 3, apat: 4, anim: 6, walo: 8 };

/** A length with its unit, converted to centimetres (m, cm, mm, ft, in, feet/inches like 7'2"). */
function toCm(value: number, unit: string | undefined): number {
  switch ((unit ?? "cm").toLowerCase()) {
    case "m": case "meter": case "meters": case "metro": return value * 100;
    case "mm": return value / 10;
    case "ft": case "feet": case "foot": case "'": case "talampakan": return value * 30.48;
    case "in": case "inch": case "inches": case "\"": case "pulgada": return value * 2.54;
    default: return value;
  }
}
const UNIT = "(cm|mm|m|meters?|metro|ft|feet|foot|in|inch(?:es)?|talampakan|pulgada|'|\")";
const round1 = (n: number) => Math.round(n * 10) / 10;
const clampOk = (n: number) => n > 0 && n <= 1000;

function readDims(t: string, understood: string[]): Pick<AssistantPatch, "width_cm" | "height_cm" | "depth_cm"> {
  const out: Pick<AssistantPatch, "width_cm" | "height_cm" | "depth_cm"> = {};
  // "200 x 76 x 95 cm" (W × H × D, the shop's order) or "200x95" (W × D)
  const triple = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*[x×*by]+\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*[x×*by]+\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?`));
  if (triple) {
    // each value keeps its own unit ("3ft x 7ft x 2in"); a bare value takes the last unit given ("90 x 210 x 4.5 cm")
    const fallback = triple[6] ?? triple[4] ?? triple[2];
    const [w, h, d] = [[triple[1], triple[2]], [triple[3], triple[4]], [triple[5], triple[6]]]
      .map(([v, u]) => round1(toCm(Number(v), u ?? fallback)));
    if ([w, h, d].every(clampOk)) {
      Object.assign(out, { width_cm: String(w), height_cm: String(h), depth_cm: String(d) });
      understood.push(`Size: ${w} × ${h} × ${d} cm (W × H × D)`);
      return out;
    }
  }
  // labelled sizes: "2 meters long", "width 180", "90cm deep", "7 ft tall"
  const labelled: [keyof typeof out, RegExp, RegExp][] = [
    ["width_cm", new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*(?:wide|width|long|length|haba|lapad)`), new RegExp(`(?:width|wide|length|long|haba|lapad)\\s*(?:of|is|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?`)],
    ["height_cm", new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*(?:tall|high|height|taas)`), new RegExp(`(?:height|tall|high|taas)\\s*(?:of|is|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?`)],
    ["depth_cm", new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*(?:deep|depth|lalim|thick)`), new RegExp(`(?:depth|deep|lalim|thick)\\s*(?:of|is|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?`)],
  ];
  const label = { width_cm: "Width", height_cm: "Height", depth_cm: "Depth" } as const;
  for (const [key, after, before] of labelled) {
    const m = t.match(after) ?? t.match(before);
    if (!m) continue;
    const cm = round1(toCm(Number(m[1]), m[2]));
    if (!clampOk(cm)) continue;
    out[key] = String(cm);
    understood.push(`${label[key]}: ${cm} cm`);
  }
  return out;
}

/**
 * Reads a description and returns only what it is sure about. `current` is the
 * configurator's category, so "make it 2 meters" can resize the piece already chosen.
 */
export function parseRequest(text: string, current?: { furniture_category: FurnitureCategory | "" }): AssistantResult {
  const t = ` ${text.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ")} `;
  const patch: AssistantPatch = {};
  const understood: string[] = [];
  const notes: string[] = [];

  // category (+ a design for the Custom Piece words)
  let category: FurnitureCategory | undefined;
  for (const [re, cat, variant] of CATEGORY_WORDS) {
    if (!re.test(t)) continue;
    category = cat;
    patch.furniture_category = cat;
    if (variant) patch.design_variant = variant;
    break;
  }
  const cat = category ?? (current?.furniture_category || undefined);
  if (category) understood.push(`Type: ${patch.design_variant && category === "Custom Piece" ? patch.design_variant : category}`);

  // design: seats for dining tables, then keywords
  if (cat && !patch.design_variant) {
    const seats = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|ten|twelve|apat|anim|walo)\s*(?:-|\s)?(?:seater|seats?|people|persons?|pax|katao|tao)\b/)
      ?? t.match(/\b(?:for|pang)\s*(\d{1,2}|four|six|eight|apat|anim|walo)\b/);
    if (cat === "Dining Table" && seats) {
      const n = Number(seats[1]) || NUMBER_WORDS[seats[1]] || 0;
      const v = n <= 4 ? "4-Seater Rectangular" : n <= 6 ? "6-Seater Classic" : "8-Seater Banquet";
      patch.design_variant = v;
      understood.push(`Design: ${v}${n > 8 ? " (the largest standard table; tell the shop you need seats for " + n + ")" : ""}`);
    } else {
      const hit = VARIANT_WORDS[cat].find(([re]) => re.test(t));
      if (hit) {
        patch.design_variant = hit[1];
        understood.push(`Design: ${hit[1]}`);
      }
    }
    // a new category without a recognised design starts from its first design and standard size
    if (category && !patch.design_variant) patch.design_variant = CATALOG[category].variants[0];
  }
  if (category && category !== current?.furniture_category) {
    const p = CATALOG[category].presets[0];
    if (p) Object.assign(patch, { width_cm: String(p.width_cm), height_cm: String(p.height_cm), depth_cm: String(p.depth_cm) });
  }

  // sizes (override the preset when given)
  Object.assign(patch, readDims(t, understood));

  // wood
  if (/\bmahogany|mahugani\b/.test(t)) { patch.wood_type = "Mahogany"; understood.push("Wood: Mahogany"); }
  else if (/\bgmelina|gemelina|yemane\b/.test(t)) { patch.wood_type = "Gmelina"; understood.push("Wood: Gmelina"); }
  else {
    const other = OTHER_WOODS.find((w) => new RegExp(`\\b${w}\\b`).test(t));
    if (other) {
      const name = other[0].toUpperCase() + other.slice(1);
      patch.wood_type = "Other";
      patch.custom_wood_note = name;
      understood.push(`Wood: ${name} (other wood — the shop confirms availability)`);
    }
  }

  // finish
  const fin = FINISH_WORDS.find(([re]) => re.test(t));
  if (fin) { patch.color_finish = fin[1]; understood.push(`Finish: ${fin[1]}`); }

  // quantity: "2 pieces", "pair of", "x2", "dalawa"
  const noDims = t.replace(/\d+(?:\.\d+)?\s*[a-z'"]*\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*[a-z'"]*\s*[x×*]\s*\d+(?:\.\d+)?)?/g, " "); // "x 4" inside a size is not a quantity
  const q = noDims.match(/\b(\d{1,2})\s*(?:pcs|pieces?|units?|sets?|piraso)\b/) ?? noDims.match(/\bx\s*(\d{1,2})\b/);
  const qty = q ? Number(q[1]) : /\bpair\b/.test(t) ? 2 : 0;
  if (qty > 1 && qty <= 50) { patch.quantity = String(qty); understood.push(`Quantity: ${qty}`); }

  // things a person must answer
  if (/\b(price|cost|how much|magkano|budget|₱|php|peso)/.test(t)) notes.push("Price: the shop sends the official quotation after confirming your order.");
  if (/\b(deliver|delivery|when|kailan|deadline|rush|urgent|needed|before|until)/.test(t)) notes.push("Timing: your words were copied to “Notes for the shop”; the shop confirms the dates.");
  if (/\b(carv|engrav|inlay|drawer|lock|mirror|cushion|foam|upholster)/.test(t)) notes.push("Extra details (carving, drawers, cushions…): copied to “Notes for the shop” so they are quoted.");

  const photoCat = patch.furniture_category ?? (cat as FurnitureCategory | undefined);
  const photo = photoCat ? PHOTO_LIBRARY.find((p) => p.category === photoCat) ?? null : null;
  return { patch, understood, notes, photo: photo ? { src: photo.src, alt: photo.alt, caption: photo.caption } : null };
}
