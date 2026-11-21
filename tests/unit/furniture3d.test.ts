import { describe, expect, it } from "vitest";
import { buildSeedTables } from "@/lib/data/seed";
import { CATALOG, FURNITURE_CATEGORIES } from "@/lib/domain/furniture";
import { buildFurnitureParts, partsBounds, type Part } from "@/lib/domain/furniture3d";
import { checkPlausibility } from "@/lib/domain/plausibility";

const SIZES = [
  { w: 180, h: 85, d: 75 },
  { w: 80, h: 210, d: 4.5 },
  { w: 120, h: 76, d: 80 },
  { w: 30, h: 25, d: 10 }, // implausibly small
  { w: 900, h: 950, d: 1000 }, // implausibly large (max allowed)
  { w: 0.5, h: 0.5, d: 0.5 }, // extreme: must not invert
];

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function noInvertedParts(parts: Part[]) {
  for (const p of parts) {
    if (p.shape === "box") for (let i = 0; i < 3; i++) expect(p.max[i] - p.min[i]).toBeGreaterThan(0);
    if (p.shape === "cyl") { expect(p.h).toBeGreaterThan(0); expect(Math.max(p.rTop, p.rBottom)).toBeGreaterThan(0); expect(Math.min(p.rTop, p.rBottom)).toBeGreaterThanOrEqual(0); }
    if (p.shape === "cylZ") { expect(p.r).toBeGreaterThan(0); expect(p.len).toBeGreaterThan(0); }
  }
}

describe("parametric 3D models (1 unit = 100 cm)", () => {
  for (const cat of FURNITURE_CATEGORIES)
    for (const variant of CATALOG[cat].variants)
      for (const s of SIZES)
        it(`${cat} · ${variant} · ${s.w}×${s.h}×${s.d} fits the exact W×H×D box`, () => {
          const parts = buildFurnitureParts(cat, variant, s);
          expect(parts.length).toBeGreaterThan(3);
          noInvertedParts(parts);
          const { min, max } = partsBounds(parts);
          expect(close(min[0], -s.w / 2) && close(max[0], s.w / 2)).toBe(true);
          expect(close(min[1], 0) && close(max[1], s.h)).toBe(true);
          expect(close(min[2], -s.d / 2) && close(max[2], s.d / 2)).toBe(true);
        });

  it("uses brass, wood and (where designed) glass / linen materials", () => {
    const mats = (c: (typeof FURNITURE_CATEGORIES)[number], v: string) => new Set(buildFurnitureParts(c, v, { w: 150, h: 200, d: 60 }).map((p) => p.mat));
    expect(mats("Panel Door", "Glass-Inset Half Panel").has("glass")).toBe(true);
    expect(mats("Panel Door", "Classic 2-Panel").has("brass")).toBe(true);
    expect(mats("Kitchen / Wall Cabinet", "Glass-Front Display Hutch").has("glass")).toBe(true);
    expect(mats("Living Room Set", "3-1-1 Slatted Wooden Set").has("linen")).toBe(true);
  });
});

describe("feasibility hint (non-blocking)", () => {
  it("flags an implausible size without changing it", () => {
    const spec = { furniture_category: "Dining Table" as const, design_variant: "4-Seater Rectangular", width_cm: 30, height_cm: 76, depth_cm: 80 };
    const r = checkPlausibility(spec);
    expect(r.status).toBe("compact");
    expect(r.message).toMatch(/unusually compact .* Staff\/Owner will verify structural feasibility/);
    expect(spec.width_cm).toBe(30); // never modified
    expect(checkPlausibility({ furniture_category: "Panel Door", design_variant: "Classic 2-Panel", width_cm: 80, height_cm: 25, depth_cm: 4.5 }).axes[0].axis).toBe("Height");
    expect(checkPlausibility({ furniture_category: "Panel Door", design_variant: "Classic 2-Panel", width_cm: 900, height_cm: 25, depth_cm: 4.5 }).status).toBe("mixed");
  });
  it("is silent for NULL dimensions (shown as Dimensions Pending Clarification instead)", () => {
    expect(checkPlausibility({ furniture_category: "Dining Table", design_variant: "Round Pedestal", width_cm: null, height_cm: 76, depth_cm: 100 }).message).toBeNull();
  });
  it("accepts every catalog preset (for a matching design) and every seeded order", async () => {
    for (const cat of FURNITURE_CATEGORIES)
      for (const p of CATALOG[cat].presets)
        expect(
          CATALOG[cat].variants.some((v) => checkPlausibility({ furniture_category: cat, design_variant: v, ...p }).message === null),
          `${cat} ${JSON.stringify(p)}`,
        ).toBe(true);
    const t = await buildSeedTables();
    for (const o of t.orders.filter((x) => !x.is_legacy_incomplete))
      expect(checkPlausibility(o).message, o.order_code).toBeNull();
  });
});
