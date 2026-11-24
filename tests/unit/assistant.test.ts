import { describe, expect, it } from "vitest";
import { parseRequest } from "@/lib/domain/assistant";

describe("customization assistant (rule-based, local)", () => {
  it("reads a full description: type, seats, size in metres, other wood, finish", () => {
    const r = parseRequest("I want a 6 seater narra dining table, 2 meters long, dark finish");
    expect(r.patch).toMatchObject({ furniture_category: "Dining Table", design_variant: "6-Seater Classic", width_cm: "200", wood_type: "Other", custom_wood_note: "Narra", color_finish: "Dark Espresso" });
    expect(r.understood.join(" | ")).toMatch(/Narra .*shop confirms availability/);
    expect(r.photo?.src).toBe("/samples/dining-set-3d.jpg");
  });
  it("W × H × D with units, feet and inches", () => {
    expect(parseRequest("door 90 x 210 x 4.5 cm mahogany").patch).toMatchObject({ furniture_category: "Panel Door", width_cm: "90", height_cm: "210", depth_cm: "4.5", wood_type: "Mahogany" });
    expect(parseRequest("door 3ft x 7ft x 2in").patch).toMatchObject({ width_cm: "91.4", height_cm: "213.4", depth_cm: "5.1" });
    expect(parseRequest("make it 7 ft tall", { furniture_category: "Panel Door" }).patch).toEqual({ height_cm: "213.4" });
  });
  it("specific pieces win over generic words and pick the right design", () => {
    expect(parseRequest("kitchen cabinet with glass doors, white").patch).toMatchObject({ furniture_category: "Kitchen / Wall Cabinet", design_variant: "Glass-Front Display Hutch", color_finish: "Gloss White" });
    expect(parseRequest("queen bed frame in gmelina").patch).toMatchObject({ furniture_category: "Custom Piece", design_variant: "Bed Frame", wood_type: "Gmelina" });
    expect(parseRequest("L-shape sala set, walnut").patch).toMatchObject({ furniture_category: "Living Room Set", design_variant: "L-Shape Corner Frame", color_finish: "Walnut Stain" });
    expect(parseRequest("pinto na arch, kulay natural").patch).toMatchObject({ furniture_category: "Panel Door", design_variant: "Arch-Top Single Panel", color_finish: "Natural Varnish" });
  });
  it("Filipino seat words, pairs and quantities", () => {
    expect(parseRequest("lamesa pang walo").patch.design_variant).toBe("8-Seater Banquet");
    expect(parseRequest("a pair of sala chairs").patch.quantity).toBe("2");
    expect(parseRequest("3 pcs overhead cabinet").patch).toMatchObject({ quantity: "3", design_variant: "2-Door Overhead" });
  });
  it("never invents: price, dates and extras are passed to a person; nonsense changes nothing", () => {
    const r = parseRequest("how much for a carved door, needed before Christmas?");
    expect(r.notes.length).toBe(3);
    expect(r.patch.furniture_category).toBe("Panel Door");
    expect(parseRequest("hello there").patch).toEqual({});
    const big = parseRequest("door 5000 x 210 x 4 cm"); // out of range: ignored, the standard size stays
    expect(big.patch.width_cm).toBe("80");
    expect(big.patch.quantity).toBeUndefined();
    expect(big.understood.some((u) => u.startsWith("Size"))).toBe(false);
  });
});
