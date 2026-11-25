import type { FurnitureCategory } from "./furniture";

/**
 * Parametric furniture geometry for the 3D turntable — pure data, no three.js.
 *
 * Every model is built in CENTIMETRES inside the exact outer bounding box
 *   x ∈ [−W/2, W/2]   (width, centred)
 *   y ∈ [0, H]        (height, from the floor)
 *   z ∈ [−D/2, D/2]   (depth, centred; the front faces +z)
 * The renderer scales by 0.01 (1 world unit = 100 cm). Sub-components (stiles,
 * legs, rails, carcass thickness …) adapt proportionally and are clamped so the
 * mesh never inverts on unusual sizes — the outer box is ALWAYS the entered
 * W × H × D; it is never clamped.
 */
export type V3 = [number, number, number];
export type MatKey = "wood" | "woodDeep" | "brass" | "glass" | "linen";

export type Part =
  | { shape: "box"; min: V3; max: V3; mat: MatKey }
  /** vertical (y-axis) cylinder; elliptical when sx/sz differ; tapered with rTop/rBottom */
  | { shape: "cyl"; base: V3; h: number; rTop: number; rBottom: number; sx?: number; sz?: number; mat: MatKey }
  /** cylinder along z (depth), centred at `center`; `half` keeps only the upper half (arches, rounded arms) */
  | { shape: "cylZ"; center: V3; r: number; len: number; half?: boolean; mat: MatKey };

export interface Dims3 { w: number; h: number; d: number }

const EPS = 1e-6;
/** v limited to [lo, hi]; if the space is smaller than lo, the space wins (never inverts). */
const fit = (v: number, lo: number, hi: number) => Math.max(Math.min(v, hi), Math.min(lo, hi));

class Builder {
  parts: Part[] = [];
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKey = "wood") {
    if (x1 - x0 > EPS && y1 - y0 > EPS && z1 - z0 > EPS) this.parts.push({ shape: "box", min: [x0, y0, z0], max: [x1, y1, z1], mat });
  }
  cyl(x: number, y: number, z: number, h: number, rTop: number, rBottom: number, mat: MatKey = "wood", sx = 1, sz = 1) {
    if (h > EPS && Math.max(rTop, rBottom) > EPS) this.parts.push({ shape: "cyl", base: [x, y, z], h, rTop, rBottom, sx, sz, mat });
  }
  cylZ(x: number, y: number, z: number, r: number, len: number, mat: MatKey = "wood", half = false) {
    if (r > EPS && len > EPS) this.parts.push({ shape: "cylZ", center: [x, y, z], r, len, half, mat });
  }
}

// ----------------------------------------------------------------- doors ----
function panelDoor(b: Builder, variant: string, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const stile = fit(w * 0.13, 2, w * 0.3);
  const rail = fit(h * 0.06, 2, h * 0.15);
  const bottomRail = fit(h * 0.1, 2, h * 0.2);
  // frame: full depth, defines the exact outer box
  b.box(X0, X0 + stile, 0, h, Z0, Z1);
  b.box(X1 - stile, X1, 0, h, Z0, Z1);
  b.box(X0 + stile, X1 - stile, h - rail, h, Z0, Z1);
  b.box(X0 + stile, X1 - stile, 0, bottomRail, Z0, Z1);
  // recessed field panels sit inside the openings, thinner than the frame
  const pz0 = -d * 0.22, pz1 = d * 0.22;
  const ox0 = X0 + stile, ox1 = X1 - stile, oy0 = bottomRail, oy1 = h - rail;
  const openH = oy1 - oy0;
  const midRail = fit(h * 0.05, 1.5, openH * 0.15);
  const raised = (x0: number, x1: number, y0: number, y1: number) => {
    b.box(x0, x1, y0, y1, pz0, pz1, "woodDeep");
    const inset = fit(Math.min(x1 - x0, y1 - y0) * 0.14, 0.5, Math.min(x1 - x0, y1 - y0) * 0.3);
    b.box(x0 + inset, x1 - inset, y0 + inset, y1 - inset, pz0, d * 0.34); // raised field, still inside the frame depth
  };
  const rails = (ys: number[]) => {
    for (const y of ys) b.box(ox0, ox1, y - midRail / 2, y + midRail / 2, Z0, Z1);
  };
  if (variant === "Modern 4-Panel") {
    const ys = [1, 2, 3].map((i) => oy0 + (openH * i) / 4);
    rails(ys);
    const edges = [oy0, ...ys, oy1];
    for (let i = 0; i < 4; i++) raised(ox0, ox1, edges[i] + (i ? midRail / 2 : 0), edges[i + 1] - (i < 3 ? midRail / 2 : 0));
  } else if (variant === "Arch-Top Single Panel") {
    const r = fit((ox1 - ox0) / 2, 1, openH / 2);
    const springY = oy1 - r;
    b.box(ox0, ox1, oy0, springY, pz0, pz1, "woodDeep");
    b.cylZ(0, springY, 0, r, pz1 - pz0, "woodDeep", true);
    // a thinner frame web fills the spandrels around the arch (no see-through gaps)
    b.box(ox0, ox1, springY, oy1, -d * 0.12, d * 0.12);
  } else if (variant === "Glass-Inset Half Panel") {
    const y = oy0 + openH * 0.5;
    rails([y]);
    b.box(ox0, ox1, y + midRail / 2, oy1, -d * 0.06, d * 0.06, "glass");
    raised(ox0, ox1, oy0, y - midRail / 2);
  } else {
    // Classic 2-Panel: short upper, tall lower
    const y = oy0 + openH * 0.58;
    rails([y]);
    raised(ox0, ox1, y + midRail / 2, oy1);
    raised(ox0, ox1, oy0, y - midRail / 2);
  }
  // brushed brass pull plate at ergonomic height (~100 cm), flush with the front face
  const hy = fit(100, h * 0.3, h * 0.7);
  const plateH = fit(16, 2, h * 0.15);
  const px = X1 - stile / 2;
  const pw = fit(stile * 0.35, 0.4, stile * 0.8);
  b.box(px - pw / 2, px + pw / 2, hy - plateH / 2, hy + plateH / 2, Z1 - Math.min(0.6, d * 0.2), Z1, "brass");
}

// ---------------------------------------------------------------- tables ----
function diningTable(b: Builder, variant: string, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const top = fit(h * 0.05, 1.5, h * 0.15);
  const bevel = fit(Math.min(w, d) * 0.015, 0.3, Math.min(w, d) * 0.05);
  if (variant === "Round Pedestal") {
    // elliptical top exactly W × D; bevel = slightly smaller lower disc
    b.cyl(0, h - top * 0.6, 0, top * 0.6, w / 2, w / 2, "wood", 1, d / w);
    b.cyl(0, h - top, 0, top * 0.4, w / 2 - bevel, w / 2 - bevel, "wood", 1, (d / 2 - bevel) / (w / 2 - bevel || 1));
    const col = fit(Math.min(w, d) * 0.07, 2.5, Math.min(w, d) * 0.2);
    const foot = fit(h * 0.05, 1.5, h * 0.12);
    b.cyl(0, foot, 0, h - top - foot, col, col * 1.25);
    const baseR = fit(Math.min(w, d) * 0.3, col * 1.5, Math.min(w, d) / 2);
    b.cyl(0, 0, 0, foot, baseR * 0.92, baseR, "wood", 1, 1);
    return;
  }
  b.box(X0, X1, h - top * 0.6, h, Z0, Z1); // top surface (exact W × D)
  b.box(X0 + bevel, X1 - bevel, h - top, h - top * 0.6, Z0 + bevel, Z1 - bevel); // bevelled underside
  const inset = fit(Math.min(w, d) * 0.06, 2, Math.min(w, d) * 0.2);
  const leg = fit(Math.min(w, d) * 0.065, 2.5, Math.min(w, d) * 0.2);
  const apronH = fit(h * 0.12, 2, (h - top) * 0.4);
  const apronT = fit(2, 0.8, leg * 0.6);
  const ay1 = h - top, ay0 = ay1 - apronH;
  const lx0 = X0 + inset, lx1 = X1 - inset, lz0 = Z0 + inset, lz1 = Z1 - inset;
  // recessed apron rails between the legs
  b.box(lx0, lx1, ay0, ay1, lz1 - apronT, lz1, "woodDeep");
  b.box(lx0, lx1, ay0, ay1, lz0, lz0 + apronT, "woodDeep");
  b.box(lx0, lx0 + apronT, ay0, ay1, lz0, lz1, "woodDeep");
  b.box(lx1 - apronT, lx1, ay0, ay1, lz0, lz1, "woodDeep");
  // tapered legs (wide at the apron, narrow at the floor)
  const legXs = variant === "8-Seater Banquet" ? [lx0 + leg / 2, 0, lx1 - leg / 2] : [lx0 + leg / 2, lx1 - leg / 2];
  for (const x of legXs) for (const z of [lz0 + leg / 2, lz1 - leg / 2]) b.cyl(x, 0, z, h - top, leg / 2, leg * 0.3);
}

// ---------------------------------------------------------------- sala set ----
function livingRoomSet(b: Builder, variant: string, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const arm = fit(w * 0.07, 3, w * 0.2);
  const armH = fit(h * 0.66, 5, h);
  const seatY = fit(h * 0.42, 3, armH * 0.85);
  const backT = fit(d * 0.12, 2, d * 0.3);
  const railH = fit(h * 0.07, 1.5, h * 0.15);
  const curved = variant === "Classic Curved Armrest Set";
  // arms (full depth, to the floor) — define W and D
  for (const [a0, a1] of [[X0, X0 + arm], [X1 - arm, X1]] as const) {
    const top = curved ? armH - arm / 2 : armH;
    b.box(a0, a1, 0, top, Z0, Z1);
    if (curved) b.cylZ((a0 + a1) / 2, top, 0, arm / 2, d, "wood", true);
  }
  const ix0 = X0 + arm, ix1 = X1 - arm;
  // seat frame
  const frameH = fit(h * 0.1, 2, seatY * 0.5);
  b.box(ix0, ix1, seatY - frameH, seatY, Z0 + backT, Z1, "wood");
  // back frame: top rail reaches H, slats between seat and rail
  b.box(ix0, ix1, h - railH, h, Z0, Z0 + backT);
  b.box(ix0, ix1, seatY - frameH, seatY, Z0, Z0 + backT);
  const inner = ix1 - ix0;
  const n = Math.max(3, Math.round(inner / 14));
  const slatW = fit(inner / n - 3, 1, inner / n);
  for (let i = 0; i < n; i++) {
    const cx = ix0 + (inner * (i + 0.5)) / n;
    b.box(cx - slatW / 2, cx + slatW / 2, seatY, h - railH, Z0 + backT * 0.25, Z0 + backT * 0.75);
  }
  // woven linen cushions on the seat (3 seats for the 3-1-1 set)
  const cushH = fit(h * 0.11, 2, (h - seatY) * 0.4);
  const seats = variant === "L-Shape Corner Frame" ? 2 : 3;
  const gap = fit(inner * 0.01, 0.3, 1.5);
  const seatEnd = variant === "L-Shape Corner Frame" ? ix0 + inner * 0.62 : ix1;
  for (let i = 0; i < seats; i++) {
    const s0 = ix0 + ((seatEnd - ix0) * i) / seats + gap / 2;
    const s1 = ix0 + ((seatEnd - ix0) * (i + 1)) / seats - gap / 2;
    b.box(s0, s1, seatY, seatY + cushH, Z0 + backT, Z1 - fit(d * 0.03, 0.5, 3), "linen");
  }
  if (variant === "L-Shape Corner Frame") {
    // corner chaise: deeper cushion and a side back along the right arm
    b.box(seatEnd + gap, ix1, seatY, seatY + cushH, Z0 + backT, Z1, "linen");
    b.box(ix1 - backT, ix1, seatY, h, Z0 + backT, Z1 - d * 0.35);
  }
  // back cushions leaning on the slats
  const bcz1 = Z0 + backT + fit(d * 0.1, 2, d * 0.2);
  b.box(ix0 + gap, seatEnd - gap, seatY + cushH, fit(h * 0.86, seatY + cushH + 1, h - railH), Z0 + backT, bcz1, "linen");
}

// -------------------------------------------------------------- cabinets ----
function door(b: Builder, x0: number, x1: number, y0: number, y1: number, zBack: number, zFront: number, glass: boolean, pullAtRight: boolean, pullDepth: number) {
  const fw = fit(Math.min(x1 - x0, y1 - y0) * 0.14, 1, Math.min(x1 - x0, y1 - y0) * 0.3);
  // frame
  b.box(x0, x0 + fw, y0, y1, zBack, zFront);
  b.box(x1 - fw, x1, y0, y1, zBack, zFront);
  b.box(x0 + fw, x1 - fw, y1 - fw, y1, zBack, zFront);
  b.box(x0 + fw, x1 - fw, y0, y0 + fw, zBack, zFront);
  // recessed centre (glass pane or wood panel)
  const mid = (zBack + zFront) / 2;
  b.box(x0 + fw, x1 - fw, y0 + fw, y1 - fw, zBack, mid, glass ? "glass" : "woodDeep");
  // brass pull: the only part reaching the very front
  const px = pullAtRight ? x1 - fw / 2 : x0 + fw / 2;
  const ph = fit((y1 - y0) * 0.14, 2, (y1 - y0) * 0.4);
  const pw = fit(fw * 0.4, 0.4, fw * 0.8);
  const py = (y0 + y1) / 2;
  b.box(px - pw / 2, px + pw / 2, py - ph / 2, py + ph / 2, zFront, zFront + pullDepth, "brass");
}

function cabinet(b: Builder, variant: string, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const pull = fit(d * 0.03, 0.3, 1.2);
  const doorT = fit(d * 0.06, 0.6, d * 0.2);
  const zf = Z1 - pull; // door fronts; pulls reach Z1 exactly
  const counter = variant === "3-Door Base Counter";
  const topT = counter ? fit(h * 0.045, 1.5, h * 0.1) : 0;
  const toe = counter ? fit(h * 0.11, 2, h * 0.2) : 0;
  const carcassFront = zf - doorT;
  // carcass box (inset behind the doors); counter top spans the full W × D
  b.box(X0, X1, toe, h - topT, Z0, carcassFront, "wood");
  if (counter) {
    b.box(X0, X1, h - topT, h, Z0, Z1, "wood");
    const kick = fit(2, 0, w * 0.1);
    const recess = fit(d * 0.08, 0, (carcassFront - Z0) * 0.5);
    b.box(X0 + kick, X1 - kick, 0, toe, Z0, carcassFront - recess, "woodDeep");
    // the toe-kick recess keeps the floor contact inside the box
  }
  const y0 = toe, y1 = h - topT;
  if (variant === "Glass-Front Display Hutch") {
    const split = y0 + (y1 - y0) * 0.45;
    const shelfT = fit((y1 - y0) * 0.03, 0.8, Math.min(3, (y1 - split) * 0.5));
    b.box(X0, X1, split, split + shelfT, Z0, zf, "wood");
    for (const [a, c, right] of [[X0, 0, true], [0, X1, false]] as const) {
      door(b, a, c, split + shelfT, y1, zf - doorT, zf, true, right, pull);
      door(b, a, c, y0, split, zf - doorT, zf, false, right, pull);
    }
    return;
  }
  const n = counter ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const a = X0 + (w * i) / n, c = X0 + (w * (i + 1)) / n;
    door(b, a, c, y0, y1, zf - doorT, zf, false, i < n / 2, pull);
  }
}

// ---------------------------------------------------------- custom pieces ----
function customPiece(b: Builder, variant: string, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  if (variant === "Bed Frame") {
    const hbT = fit(d * 0.03, 2, d * 0.1);
    const footH = fit(h * 0.42, 5, h);
    const railY0 = fit(h * 0.18, 1, footH * 0.6);
    const railH = fit(h * 0.14, 2, footH - railY0);
    const post = fit(w * 0.05, 3, w * 0.15);
    // headboard (full W, full H) and footboard
    b.box(X0, X1, 0, h, Z0, Z0 + hbT);
    b.box(X0 + post, X1 - post, h * 0.25, h - fit(h * 0.06, 1, 8), Z0 + hbT * 0.25, Z0 + hbT * 0.75, "woodDeep");
    b.box(X0, X1, 0, footH, Z1 - hbT, Z1);
    // side rails and the slatted platform
    b.box(X0, X0 + post, railY0, railY0 + railH, Z0 + hbT, Z1 - hbT);
    b.box(X1 - post, X1, railY0, railY0 + railH, Z0 + hbT, Z1 - hbT);
    const slats = Math.max(4, Math.round((d - 2 * hbT) / 12));
    const span = d - 2 * hbT;
    for (let i = 0; i < slats; i++) {
      const z = Z0 + hbT + (span * (i + 0.5)) / slats;
      const half = fit(span / slats / 2 - 1.5, 0.5, span / slats / 2);
      const slatT = fit(2.5, 0.1, railH);
      b.box(X0 + post, X1 - post, railY0 + railH - slatT, railY0 + railH, z - half, z + half, "woodDeep");
    }
    // legs under the four corners
    const legR = Math.min(post * 0.4, hbT / 2);
    for (const x of [X0 + post / 2, X1 - post / 2]) for (const z of [Z0 + hbT / 2, Z1 - hbT / 2]) b.cyl(x, 0, z, railY0, legR, legR * 0.75);
    return;
  }
  if (variant === "Wardrobe / Aparador") {
    const pull = fit(d * 0.03, 0.3, 1.2);
    const doorT = fit(d * 0.05, 0.6, d * 0.2);
    const zf = Z1 - pull;
    const plinth = fit(h * 0.05, 2, h * 0.12);
    const cornice = fit(h * 0.04, 1.5, h * 0.1);
    b.box(X0, X1, h - cornice, h, Z0, zf, "wood");
    b.box(X0, X1, 0, plinth, Z0, zf - doorT, "woodDeep");
    b.box(X0, X1, plinth, h - cornice, Z0, zf - doorT, "wood");
    door(b, X0, 0, plinth, h - cornice, zf - doorT, zf, false, true, pull);
    door(b, 0, X1, plinth, h - cornice, zf - doorT, zf, false, false, pull);
    return;
  }
  // Bookshelf / Divider: sides, top, bottom, shelves and a thin back
  const t = fit(Math.min(w, h) * 0.03, 1.2, Math.min(w, h) * 0.15);
  b.box(X0, X0 + t, 0, h, Z0, Z1);
  b.box(X1 - t, X1, 0, h, Z0, Z1);
  b.box(X0 + t, X1 - t, h - t, h, Z0, Z1);
  b.box(X0 + t, X1 - t, 0, t * 2, Z0, Z1);
  b.box(X0 + t, X1 - t, t * 2, h - t, Z0, Z0 + fit(d * 0.04, 0.4, 1.5), "woodDeep");
  const shelves = Math.max(1, Math.round(h / 38) - 1);
  const inner = h - t - t * 2;
  for (let i = 1; i <= shelves; i++) {
    const y = t * 2 + (inner * i) / (shelves + 1);
    b.box(X0 + t, X1 - t, y - t / 2, y + t / 2, Z0, Z1 - fit(d * 0.04, 0.3, 2));
  }
}

/** All parts of the selected design, in cm, inside the exact W × H × D box. */
export function buildFurnitureParts(category: FurnitureCategory, variant: string, dims: Dims3): Part[] {
  const b = new Builder();
  switch (category) {
    case "Panel Door": panelDoor(b, variant, dims); break;
    case "Dining Table": diningTable(b, variant, dims); break;
    case "Living Room Set": livingRoomSet(b, variant, dims); break;
    case "Kitchen / Wall Cabinet": cabinet(b, variant, dims); break;
    case "Custom Piece": customPiece(b, variant, dims); break;
  }
  return b.parts;
}

/** Axis-aligned bounds of a set of parts (cm). */
export function partsBounds(parts: Part[]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const grow = (lo: V3, hi: V3) => {
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); }
  };
  for (const p of parts) {
    if (p.shape === "box") grow(p.min, p.max);
    else if (p.shape === "cyl") {
      const r = Math.max(p.rTop, p.rBottom);
      const rx = r * (p.sx ?? 1), rz = r * (p.sz ?? 1);
      grow([p.base[0] - rx, p.base[1], p.base[2] - rz], [p.base[0] + rx, p.base[1] + p.h, p.base[2] + rz]);
    } else {
      grow([p.center[0] - p.r, p.center[1] - (p.half ? 0 : p.r), p.center[2] - p.len / 2], [p.center[0] + p.r, p.center[1] + p.r, p.center[2] + p.len / 2]);
    }
  }
  return { min, max };
}

