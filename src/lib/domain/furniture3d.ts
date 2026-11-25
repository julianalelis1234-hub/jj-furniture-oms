import { effectiveOptions, type LegStyle } from "./design-options";
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

/** `name` is the workshop name of the piece ("Leg", "Drawer front") used by the parts list. */
export type Part = { name?: string } & (
  | { shape: "box"; min: V3; max: V3; mat: MatKey }
  /** vertical (y-axis) cylinder; elliptical when sx/sz differ; tapered with rTop/rBottom */
  | { shape: "cyl"; base: V3; h: number; rTop: number; rBottom: number; sx?: number; sz?: number; mat: MatKey }
  /** cylinder along z (depth), centred at `center`; `half` keeps only the upper half (arches, rounded arms) */
  | { shape: "cylZ"; center: V3; r: number; len: number; half?: boolean; mat: MatKey });

export interface Dims3 { w: number; h: number; d: number }

const EPS = 1e-6;
/** v limited to [lo, hi]; if the space is smaller than lo, the space wins (never inverts). */
const fit = (v: number, lo: number, hi: number) => Math.max(Math.min(v, hi), Math.min(lo, hi));

class Builder {
  parts: Part[] = [];
  /** the workshop name given to the parts added next */
  label = "Frame piece";
  as(label: string) { this.label = label; return this; }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKey = "wood") {
    if (x1 - x0 > EPS && y1 - y0 > EPS && z1 - z0 > EPS) this.parts.push({ shape: "box", min: [x0, y0, z0], max: [x1, y1, z1], mat, name: this.label });
  }
  cyl(x: number, y: number, z: number, h: number, rTop: number, rBottom: number, mat: MatKey = "wood", sx = 1, sz = 1) {
    if (h > EPS && Math.max(rTop, rBottom) > EPS) this.parts.push({ shape: "cyl", base: [x, y, z], h, rTop, rBottom, sx, sz, mat, name: this.label });
  }
  cylZ(x: number, y: number, z: number, r: number, len: number, mat: MatKey = "wood", half = false) {
    if (r > EPS && len > EPS) this.parts.push({ shape: "cylZ", center: [x, y, z], r, len, half, mat, name: this.label });
  }
}

// ----------------------------------------------------------------- doors ----
function panelDoor(b: Builder, variant: string, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const stile = fit(w * 0.13, 2, w * 0.3);
  const rail = fit(h * 0.06, 2, h * 0.15);
  const bottomRail = fit(h * 0.1, 2, h * 0.2);
  // frame: full depth, defines the exact outer box
  b.as("Door stile");
  b.box(X0, X0 + stile, 0, h, Z0, Z1);
  b.box(X1 - stile, X1, 0, h, Z0, Z1);
  b.as("Door rail");
  b.box(X0 + stile, X1 - stile, h - rail, h, Z0, Z1);
  b.box(X0 + stile, X1 - stile, 0, bottomRail, Z0, Z1);
  // recessed field panels sit inside the openings, thinner than the frame
  const pz0 = -d * 0.22, pz1 = d * 0.22;
  const ox0 = X0 + stile, ox1 = X1 - stile, oy0 = bottomRail, oy1 = h - rail;
  const openH = oy1 - oy0;
  const midRail = fit(h * 0.05, 1.5, openH * 0.15);
  const raised = (x0: number, x1: number, y0: number, y1: number) => {
    b.as("Door panel");
    b.box(x0, x1, y0, y1, pz0, pz1, "woodDeep");
    b.as("Raised panel face");
    const inset = fit(Math.min(x1 - x0, y1 - y0) * 0.14, 0.5, Math.min(x1 - x0, y1 - y0) * 0.3);
    b.box(x0 + inset, x1 - inset, y0 + inset, y1 - inset, pz0, d * 0.34); // raised field, still inside the frame depth
  };
  const rails = (ys: number[]) => {
    b.as("Door mid rail");
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
    b.as("Door panel");
    b.box(ox0, ox1, oy0, springY, pz0, pz1, "woodDeep");
    b.as("Arch panel top");
    b.cylZ(0, springY, 0, r, pz1 - pz0, "woodDeep", true);
    b.as("Arch frame web");
    // a thinner frame web fills the spandrels around the arch (no see-through gaps)
    b.box(ox0, ox1, springY, oy1, -d * 0.12, d * 0.12);
  } else if (variant === "Glass-Inset Half Panel") {
    const y = oy0 + openH * 0.5;
    rails([y]);
    b.as("Glass pane");
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
  b.as("Pull plate");
  b.box(px - pw / 2, px + pw / 2, hy - plateH / 2, hy + plateH / 2, Z1 - Math.min(0.6, d * 0.2), Z1, "brass");
}

// ---------------------------------------------------------------- tables ----
function diningTable(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const top = fit(h * 0.05, 1.5, h * 0.15);
  const bevel = fit(Math.min(w, d) * 0.015, 0.3, Math.min(w, d) * 0.05);
  if (variant === "Round Pedestal") {
    // elliptical top exactly W × D; bevel = slightly smaller lower disc
    b.as("Table top");
    b.cyl(0, h - top * 0.6, 0, top * 0.6, w / 2, w / 2, "wood", 1, d / w);
    b.cyl(0, h - top, 0, top * 0.4, w / 2 - bevel, w / 2 - bevel, "wood", 1, (d / 2 - bevel) / (w / 2 - bevel || 1));
    const col = fit(Math.min(w, d) * 0.07, 2.5, Math.min(w, d) * 0.2);
    const foot = fit(h * 0.05, 1.5, h * 0.12);
    b.as("Pedestal column");
    b.cyl(0, foot, 0, h - top - foot, col, col * 1.25);
    b.as("Pedestal base");
    const baseR = fit(Math.min(w, d) * 0.3, col * 1.5, Math.min(w, d) / 2);
    b.cyl(0, 0, 0, foot, baseR * 0.92, baseR, "wood", 1, 1);
    return;
  }
  b.as("Table top");
  b.box(X0, X1, h - top * 0.6, h, Z0, Z1); // top surface (exact W × D)
  b.as("Top bevel / cleat");
  b.box(X0 + bevel, X1 - bevel, h - top, h - top * 0.6, Z0 + bevel, Z1 - bevel); // bevelled underside
  const inset = fit(Math.min(w, d) * 0.06, 2, Math.min(w, d) * 0.2);
  const leg = fit(Math.min(w, d) * 0.065, 2.5, Math.min(w, d) * 0.2);
  const apronH = fit(h * 0.12, 2, (h - top) * 0.4);
  const apronT = fit(2, 0.8, leg * 0.6);
  const ay1 = h - top, ay0 = ay1 - apronH;
  const lx0 = X0 + inset, lx1 = X1 - inset, lz0 = Z0 + inset, lz1 = Z1 - inset;
  // recessed apron rails between the legs
  b.as("Apron rail");
  b.box(lx0, lx1, ay0, ay1, lz1 - apronT, lz1, "woodDeep");
  b.box(lx0, lx1, ay0, ay1, lz0, lz0 + apronT, "woodDeep");
  b.box(lx0, lx0 + apronT, ay0, ay1, lz0, lz1, "woodDeep");
  b.box(lx1 - apronT, lx1, ay0, ay1, lz0, lz1, "woodDeep");
  // tapered legs (wide at the apron, narrow at the floor)
  const legXs = variant === "8-Seater Banquet" ? [lx0 + leg / 2, 0, lx1 - leg / 2] : [lx0 + leg / 2, lx1 - leg / 2];
  b.as("Leg");
  for (const x of legXs) for (const z of [lz0 + leg / 2, lz1 - leg / 2]) legAt(b, x, z, h - top, leg, o.legs ?? "tapered");
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
  b.as("Arm");
  for (const [a0, a1] of [[X0, X0 + arm], [X1 - arm, X1]] as const) {
    const top = curved ? armH - arm / 2 : armH;
    b.box(a0, a1, 0, top, Z0, Z1);
    if (curved) b.cylZ((a0 + a1) / 2, top, 0, arm / 2, d, "wood", true);
  }
  const ix0 = X0 + arm, ix1 = X1 - arm;
  // seat frame
  const frameH = fit(h * 0.1, 2, seatY * 0.5);
  b.as("Seat frame");
  b.box(ix0, ix1, seatY - frameH, seatY, Z0 + backT, Z1, "wood");
  b.as("Back rail");
  // back frame: top rail reaches H, slats between seat and rail
  b.box(ix0, ix1, h - railH, h, Z0, Z0 + backT);
  b.box(ix0, ix1, seatY - frameH, seatY, Z0, Z0 + backT);
  const inner = ix1 - ix0;
  const n = Math.max(3, Math.round(inner / 14));
  const slatW = fit(inner / n - 3, 1, inner / n);
  b.as("Back slat");
  for (let i = 0; i < n; i++) {
    const cx = ix0 + (inner * (i + 0.5)) / n;
    b.box(cx - slatW / 2, cx + slatW / 2, seatY, h - railH, Z0 + backT * 0.25, Z0 + backT * 0.75);
  }
  b.as("Seat cushion");
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
    b.as("Side back");
    b.box(ix1 - backT, ix1, seatY, h, Z0 + backT, Z1 - d * 0.35);
  }
  b.as("Back cushion");
  // back cushions leaning on the slats
  const bcz1 = Z0 + backT + fit(d * 0.1, 2, d * 0.2);
  b.box(ix0 + gap, seatEnd - gap, seatY + cushH, fit(h * 0.86, seatY + cushH + 1, h - railH), Z0 + backT, bcz1, "linen");
}

// -------------------------------------------------------------- cabinets ----
function door(b: Builder, x0: number, x1: number, y0: number, y1: number, zBack: number, zFront: number, glass: boolean, pullAtRight: boolean, pullDepth: number) {
  const fw = fit(Math.min(x1 - x0, y1 - y0) * 0.14, 1, Math.min(x1 - x0, y1 - y0) * 0.3);
  // frame
  b.as("Door frame piece");
  b.box(x0, x0 + fw, y0, y1, zBack, zFront);
  b.box(x1 - fw, x1, y0, y1, zBack, zFront);
  b.box(x0 + fw, x1 - fw, y1 - fw, y1, zBack, zFront);
  b.box(x0 + fw, x1 - fw, y0, y0 + fw, zBack, zFront);
  // recessed centre (glass pane or wood panel)
  const mid = (zBack + zFront) / 2;
  b.as(glass ? "Glass pane" : "Door panel");
  b.box(x0 + fw, x1 - fw, y0 + fw, y1 - fw, zBack, mid, glass ? "glass" : "woodDeep");
  b.as("Pull");
  // brass pull: the only part reaching the very front
  const px = pullAtRight ? x1 - fw / 2 : x0 + fw / 2;
  const ph = fit((y1 - y0) * 0.14, 2, (y1 - y0) * 0.4);
  const pw = fit(fw * 0.4, 0.4, fw * 0.8);
  const py = (y0 + y1) / 2;
  b.box(px - pw / 2, px + pw / 2, py - ph / 2, py + ph / 2, zFront, zFront + pullDepth, "brass");
}

function cabinet(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const pull = fit(d * 0.03, 0.3, 1.2);
  const doorT = fit(d * 0.06, 0.6, d * 0.2);
  const zf = Z1 - pull; // door fronts; pulls reach Z1 exactly
  const counter = variant === "3-Door Base Counter";
  const topT = counter ? fit(h * 0.045, 1.5, h * 0.1) : 0;
  const toe = counter ? fit(h * 0.11, 2, h * 0.2) : 0;
  const carcassFront = zf - doorT;
  // carcass box (inset behind the doors); counter top spans the full W × D
  b.as("Carcass");
  b.box(X0, X1, toe, h - topT, Z0, carcassFront, "wood");
  if (counter) {
    b.as("Counter top");
    b.box(X0, X1, h - topT, h, Z0, Z1, "wood");
    b.as("Toe kick");
    const kick = fit(2, 0, w * 0.1);
    const recess = fit(d * 0.08, 0, (carcassFront - Z0) * 0.5);
    b.box(X0 + kick, X1 - kick, 0, toe, Z0, carcassFront - recess, "woodDeep");
    // the toe-kick recess keeps the floor contact inside the box
  }
  const y0 = toe, y1 = h - topT;
  if (variant === "Glass-Front Display Hutch") {
    const split = y0 + (y1 - y0) * 0.45;
    const shelfT = fit((y1 - y0) * 0.03, 0.8, Math.min(3, (y1 - split) * 0.5));
    b.as("Middle shelf");
    b.box(X0, X1, split, split + shelfT, Z0, zf, "wood");
    for (const [a, c, right] of [[X0, 0, true], [0, X1, false]] as const) {
      door(b, a, c, split + shelfT, y1, zf - doorT, zf, true, right, pull);
      door(b, a, c, y0, split, zf - doorT, zf, false, right, pull);
    }
    return;
  }
  // a row of drawers under the counter top, then the doors
  const nd = o.drawers ?? 0;
  const dy = nd > 0 ? y1 - fit((y1 - y0) * 0.22, 6, (y1 - y0) * 0.4) : y1;
  if (nd > 0) drawerRow(b, X0, X1, dy, y1, zf - doorT, zf, nd, pull);
  const n = o.doors ?? (counter ? 3 : 2);
  for (let i = 0; i < n; i++) {
    const a = X0 + (w * i) / n, c = X0 + (w * (i + 1)) / n;
    door(b, a, c, y0, dy, zf - doorT, zf, false, i < n / 2, pull);
  }
}

// ---------------------------------------------------------- custom pieces ----
function customPiece(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  if (variant === "Bed Frame") {
    const hbT = fit(d * 0.03, 2, d * 0.1);
    const footH = fit(h * 0.42, 5, h);
    const railY0 = fit(h * 0.18, 1, footH * 0.6);
    const railH = fit(h * 0.14, 2, footH - railY0);
    const post = fit(w * 0.05, 3, w * 0.15);
    // headboard (full W, full H) and footboard
    b.as("Headboard");
    b.box(X0, X1, 0, h, Z0, Z0 + hbT);
    b.as("Headboard inset panel");
    b.box(X0 + post, X1 - post, h * 0.25, h - fit(h * 0.06, 1, 8), Z0 + hbT * 0.25, Z0 + hbT * 0.75, "woodDeep");
    b.as("Footboard");
    b.box(X0, X1, 0, footH, Z1 - hbT, Z1);
    b.as("Side rail");
    // side rails and the slatted platform
    b.box(X0, X0 + post, railY0, railY0 + railH, Z0 + hbT, Z1 - hbT);
    b.box(X1 - post, X1, railY0, railY0 + railH, Z0 + hbT, Z1 - hbT);
    const slats = Math.max(4, Math.round((d - 2 * hbT) / 12));
    const span = d - 2 * hbT;
    b.as("Bed slat");
    for (let i = 0; i < slats; i++) {
      const z = Z0 + hbT + (span * (i + 0.5)) / slats;
      const half = fit(span / slats / 2 - 1.5, 0.5, span / slats / 2);
      const slatT = fit(2.5, 0.1, railH);
      b.box(X0 + post, X1 - post, railY0 + railH - slatT, railY0 + railH, z - half, z + half, "woodDeep");
    }
    // legs under the four corners
    const legR = Math.min(post * 0.4, hbT / 2);
    b.as("Leg");
    for (const x of [X0 + post / 2, X1 - post / 2]) for (const z of [Z0 + hbT / 2, Z1 - hbT / 2]) b.cyl(x, 0, z, railY0, legR, legR * 0.75);
    return;
  }
  if (variant === "Wardrobe / Aparador") {
    const pull = fit(d * 0.03, 0.3, 1.2);
    const doorT = fit(d * 0.05, 0.6, d * 0.2);
    const zf = Z1 - pull;
    const plinth = fit(h * 0.05, 2, h * 0.12);
    const cornice = fit(h * 0.04, 1.5, h * 0.1);
    b.as("Cornice / top");
    b.box(X0, X1, h - cornice, h, Z0, zf, "wood");
    b.as("Plinth");
    b.box(X0, X1, 0, plinth, Z0, zf - doorT, "woodDeep");
    b.as("Carcass");
    b.box(X0, X1, plinth, h - cornice, Z0, zf - doorT, "wood");
    const nd = o.drawers ?? 0;
    const dTop = nd > 0 ? plinth + fit((h - cornice - plinth) * 0.2, 10, (h - cornice - plinth) * 0.35) : plinth;
    if (nd > 0) drawerRow(b, X0, X1, plinth, dTop, zf - doorT, zf, nd, pull);
    const nDoors = o.doors ?? 2;
    for (let i = 0; i < nDoors; i++) {
      const a = X0 + (w * i) / nDoors, c = X0 + (w * (i + 1)) / nDoors;
      door(b, a, c, dTop, h - cornice, zf - doorT, zf, false, i < nDoors / 2, pull);
    }
    return;
  }
  // Bookshelf / Divider: sides, top, bottom, shelves and a thin back
  const t = fit(Math.min(w, h) * 0.03, 1.2, Math.min(w, h) * 0.15);
  b.as("Side panel");
  b.box(X0, X0 + t, 0, h, Z0, Z1);
  b.box(X1 - t, X1, 0, h, Z0, Z1);
  b.as("Top board");
  b.box(X0 + t, X1 - t, h - t, h, Z0, Z1);
  b.as("Bottom board");
  b.box(X0 + t, X1 - t, 0, t * 2, Z0, Z1);
  b.as("Back panel");
  b.box(X0 + t, X1 - t, t * 2, h - t, Z0, Z0 + fit(d * 0.04, 0.4, 1.5), "woodDeep");
  b.as("Shelf");
  const shelves = o.shelves ?? Math.max(1, Math.round(h / 38) - 1);
  const inner = h - t - t * 2;
  for (let i = 1; i <= shelves; i++) {
    const y = t * 2 + (inner * i) / (shelves + 1);
    b.box(X0 + t, X1 - t, y - t / 2, y + t / 2, Z0, Z1 - fit(d * 0.04, 0.3, 2));
  }
}

// ------------------------------------------------------------- shared parts ----
type Opts = { drawers?: number | null; shelves?: number | null; doors?: number | null; legs?: LegStyle };

/** One leg from the floor up to `top`, centred at (x, z): tapered round or straight square. */
function legAt(b: Builder, x: number, z: number, top: number, size: number, style: LegStyle) {
  if (style === "tapered") b.cyl(x, 0, z, top, size / 2, size * 0.3);
  else b.box(x - size / 2, x + size / 2, 0, top, z - size / 2, z + size / 2);
}

/** Four (or six for long pieces) legs inset from the corners. */
function fourLegs(b: Builder, X0: number, X1: number, Z0: number, Z1: number, top: number, size: number, style: LegStyle, inset = 0) {
  b.as("Leg");
  const xs = X1 - X0 > 170 ? [X0 + inset + size / 2, (X0 + X1) / 2, X1 - inset - size / 2] : [X0 + inset + size / 2, X1 - inset - size / 2];
  for (const x of xs) for (const z of [Z0 + inset + size / 2, Z1 - inset - size / 2]) legAt(b, x, z, top, size, style);
}

/** One drawer: a front panel with a small gap around it and a brass pull. */
function drawerFront(b: Builder, x0: number, x1: number, y0: number, y1: number, zBack: number, zFront: number, pullDepth: number) {
  const g = fit(Math.min(x1 - x0, y1 - y0) * 0.03, 0.2, 0.5);
  b.as("Drawer front");
  b.box(x0 + g, x1 - g, y0 + g, y1 - g, zBack, zFront, "woodDeep");
  b.as("Drawer pull");
  const pw = fit((x1 - x0) * 0.22, 2, 14), ph = fit((y1 - y0) * 0.12, 0.8, 2);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  b.box(cx - pw / 2, cx + pw / 2, cy - ph / 2, cy + ph / 2, zFront, zFront + pullDepth, "brass");
}

/** n drawers side by side between x0 and x1. */
function drawerRow(b: Builder, x0: number, x1: number, y0: number, y1: number, zBack: number, zFront: number, n: number, pullDepth: number) {
  for (let i = 0; i < n; i++) drawerFront(b, x0 + ((x1 - x0) * i) / n, x0 + ((x1 - x0) * (i + 1)) / n, y0, y1, zBack, zFront, pullDepth);
}

/** n drawers stacked between y0 and y1. */
function drawerStack(b: Builder, x0: number, x1: number, y0: number, y1: number, zBack: number, zFront: number, n: number, pullDepth: number) {
  for (let i = 0; i < n; i++) drawerFront(b, x0, x1, y0 + ((y1 - y0) * i) / n, y0 + ((y1 - y0) * (i + 1)) / n, zBack, zFront, pullDepth);
}

/** An open box carcass (sides, top, bottom, back) from y0 to y1; returns the inner faces. */
function carcass(b: Builder, X0: number, X1: number, y0: number, y1: number, Z0: number, zFront: number, t: number) {
  b.as("Side panel");
  b.box(X0, X0 + t, y0, y1, Z0, zFront);
  b.box(X1 - t, X1, y0, y1, Z0, zFront);
  b.as("Top board");
  b.box(X0, X1, y1 - t, y1, Z0, zFront);
  b.as("Bottom board");
  b.box(X0 + t, X1 - t, y0, y0 + t, Z0, zFront);
  b.as("Back panel");
  b.box(X0 + t, X1 - t, y0 + t, y1 - t, Z0, Z0 + fit(t * 0.4, 0.4, 1.2), "woodDeep");
  return { ix0: X0 + t, ix1: X1 - t, iy0: y0 + t, iy1: y1 - t };
}

// ----------------------------------------------------------------- chairs ----
function chair(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  if (variant === "Rocking Chair") return rockingChair(b, { w, h, d });
  const arm = variant === "Armchair";
  const seatY = fit(h * (arm ? 0.45 : 0.5), 25, h * 0.7);
  const seatT = fit(h * 0.03, 1.5, 4);
  const leg = fit(Math.min(w, d) * 0.08, 2.5, 6);
  const sideW = arm ? fit(w * 0.1, 4, 9) : 0;
  const sx0 = X0 + sideW, sx1 = X1 - sideW;
  // back posts: full height at the back corners
  b.as("Back post");
  b.box(sx0, sx0 + leg, 0, h, Z0, Z0 + leg);
  b.box(sx1 - leg, sx1, 0, h, Z0, Z0 + leg);
  // front legs
  b.as("Front leg");
  for (const x of [sx0 + leg / 2, sx1 - leg / 2]) legAt(b, x, Z1 - leg / 2, seatY - seatT, leg, o.legs ?? "tapered");
  // seat rails and seat
  b.as("Seat rail");
  const railH = fit(h * 0.06, 3, 8);
  b.box(sx0 + leg, sx1 - leg, seatY - seatT - railH, seatY - seatT, Z1 - leg, Z1 - leg * 0.4, "woodDeep");
  b.box(sx0 + leg, sx1 - leg, seatY - seatT - railH, seatY - seatT, Z0 + leg * 0.4, Z0 + leg, "woodDeep");
  b.as("Seat board");
  b.box(sx0, sx1, seatY - seatT, seatY, Z0 + leg, Z1);
  // back: top rail and slats
  const topRail = fit(h * 0.07, 4, 10);
  b.as("Back top rail");
  b.box(sx0 + leg, sx1 - leg, h - topRail, h, Z0, Z0 + leg * 0.8);
  b.as("Back slat");
  const inner = sx1 - sx0 - 2 * leg;
  const n = Math.max(2, Math.round(inner / 9));
  for (let i = 0; i < n; i++) {
    const cx = sx0 + leg + (inner * (i + 0.5)) / n;
    const sw = fit(inner / n - 2.5, 1, 6);
    b.box(cx - sw / 2, cx + sw / 2, seatY + fit(h * 0.04, 2, 6), h - topRail, Z0 + leg * 0.2, Z0 + leg * 0.6);
  }
  if (arm) {
    const armY = seatY + (h - seatY) * 0.42;
    b.as("Arm rest");
    b.box(X0, X0 + sideW, armY - 3, armY, Z0, Z1);
    b.box(X1 - sideW, X1, armY - 3, armY, Z0, Z1);
    b.as("Arm post");
    b.box(X0 + sideW * 0.2, X0 + sideW * 0.8, seatY - seatT, armY - 3, Z1 - leg, Z1);
    b.box(X1 - sideW * 0.8, X1 - sideW * 0.2, seatY - seatT, armY - 3, Z1 - leg, Z1);
    b.as("Arm side rail");
    b.box(X0, X0 + sideW, seatY - seatT - 6, seatY - seatT, Z0, Z1, "woodDeep");
    b.box(X1 - sideW, X1, seatY - seatT - 6, seatY - seatT, Z0, Z1, "woodDeep");
    b.as("Seat cushion");
    b.box(sx0 + 0.5, sx1 - 0.5, seatY, seatY + fit(h * 0.07, 3, 8), Z0 + leg, Z1 - 0.5, "linen");
  }
}

function rockingChair(b: Builder, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const rockerH = fit(h * 0.06, 3, 7), rockerT = fit(w * 0.05, 2.5, 4);
  // curved rockers: the lowest point in the middle, rising towards both ends
  const segs = 14, rise = fit(d * 0.12, 3, 14);
  const curve = (z: number) => rise * ((2 * (z - Z0)) / d - 1) ** 2;
  b.as("Rocker");
  for (const x of [X0 + rockerT / 2 + 2, X1 - rockerT / 2 - 2]) {
    for (let i = 0; i < segs; i++) {
      const za = Z0 + (d * i) / segs, zb = Z0 + (d * (i + 1)) / segs;
      const y = curve((za + zb) / 2);
      b.box(x - rockerT / 2, x + rockerT / 2, y, y + rockerH, za, zb);
    }
  }
  const sz0 = Z0 + d * 0.2, sz1 = Z1 - d * 0.18;
  const seatY = fit(h * 0.42, 25, h * 0.6);
  const post = fit(w * 0.06, 3, 5);
  const sx0 = X0 + 2, sx1 = X1 - 2;
  // legs from the rockers up to the seat
  b.as("Leg");
  for (const x of [sx0 + post / 2, sx1 - post / 2]) {
    b.box(x - post / 2, x + post / 2, curve(sz1 - post) + rockerH, seatY, sz1 - post, sz1);
  }
  // back posts from the rockers up to full height, leaning slightly back
  b.as("Back post");
  for (const x of [sx0 + post / 2, sx1 - post / 2]) b.box(x - post / 2, x + post / 2, curve(sz0) + rockerH, h, sz0 - post, sz0);
  b.as("Seat board");
  b.box(sx0, sx1, seatY - 2.5, seatY, sz0, sz1);
  b.as("Seat cushion");
  b.box(sx0 + post, sx1 - post, seatY, seatY + 5, sz0, sz1 - 1, "linen");
  b.as("Back top rail");
  b.box(sx0 + post, sx1 - post, h - 7, h, sz0 - post, sz0 - post * 0.3);
  b.as("Back slat");
  const inner = sx1 - sx0 - 2 * post, n = Math.max(3, Math.round(inner / 8));
  for (let i = 0; i < n; i++) {
    const cx = sx0 + post + (inner * (i + 0.5)) / n;
    b.box(cx - 1.5, cx + 1.5, seatY + 3, h - 7, sz0 - post * 0.8, sz0 - post * 0.4);
  }
  const armY = seatY + (h - seatY) * 0.35;
  b.as("Arm rest");
  b.box(sx0 - 2, sx0 + post + 2, armY - 3, armY, sz0 - post, sz1 + 2);
  b.box(sx1 - post - 2, sx1 + 2, armY - 3, armY, sz0 - post, sz1 + 2);
  b.as("Arm post");
  b.box(sx0, sx0 + post, seatY, armY - 3, sz1 - post, sz1);
  b.box(sx1 - post, sx1, seatY, armY - 3, sz1 - post, sz1);
}

// ----------------------------------------------------------------- benches ----
function bench(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const back = variant === "Backrest Bench";
  const seatY = back ? fit(h * 0.52, 25, h * 0.7) : h;
  const seatZ0 = back ? Z0 + fit(d * 0.12, 3, 8) : Z0;
  const topT = fit(seatY * 0.07, 2, 4.5);
  const leg = fit(Math.min(w, d) * 0.1, 3.5, 7);
  b.as("Seat board");
  b.box(X0, X1, seatY - topT, seatY, seatZ0, Z1);
  fourLegs(b, X0, X1, seatZ0, Z1, seatY - topT, leg, o.legs ?? "straight", fit(w * 0.04, 1, 6));
  b.as("Stretcher");
  b.box(X0 + leg + 4, X1 - leg - 4, seatY * 0.25, seatY * 0.25 + fit(leg * 0.7, 2, 5), (seatZ0 + Z1) / 2 - 1.5, (seatZ0 + Z1) / 2 + 1.5, "woodDeep");
  if (back) {
    b.as("Back post");
    for (const x of [X0 + 4, X1 - 4 - leg]) b.box(x, x + leg, seatY - topT, h, Z0, Z0 + leg * 0.7);
    b.as("Back top rail");
    b.box(X0 + 4, X1 - 4, h - 7, h, Z0, Z0 + leg * 0.6);
    b.as("Back slat");
    const inner = w - 8 - 2 * leg, n = Math.max(3, Math.round(inner / 10));
    for (let i = 0; i < n; i++) {
      const cx = X0 + 4 + leg + (inner * (i + 0.5)) / n;
      b.box(cx - 2.5, cx + 2.5, seatY + 3, h - 7, Z0 + leg * 0.15, Z0 + leg * 0.5);
    }
  }
}

// ---------------------------------------------------------- tv / console ----
function tvConsole(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const pull = fit(d * 0.03, 0.3, 1.2);
  const zf = Z1 - pull;
  if (variant === "Console Table") {
    const topT = fit(h * 0.04, 2, 3.5);
    const leg = fit(Math.min(w, d) * 0.09, 3, 5.5);
    b.as("Table top");
    b.box(X0, X1, h - topT, h, Z0, zf);
    fourLegs(b, X0, X1, Z0, zf, h - topT, leg, o.legs ?? "tapered", 1);
    const apronH = fit(h * 0.16, 8, 16);
    const nd = o.drawers ?? 0;
    if (nd > 0) drawerRow(b, X0 + leg + 1, X1 - leg - 1, h - topT - apronH, h - topT, zf - 2, zf, nd, pull);
    else { b.as("Apron rail"); b.box(X0 + leg, X1 - leg, h - topT - apronH, h - topT, zf - 2, zf, "woodDeep"); }
    if ((o.shelves ?? 0) > 0) { b.as("Lower shelf"); b.box(X0 + leg, X1 - leg, h * 0.15, h * 0.15 + 2, Z0 + leg, zf - leg); }
    return;
  }
  // Low TV stand: short feet, a carcass with drawers on top, doors and an open middle section
  const feet = fit(h * 0.14, 3, 12);
  const t = fit(Math.min(w, h) * 0.04, 1.6, 2.5);
  const doorT = fit(d * 0.05, 1.2, 2);
  b.as("Foot");
  for (const x of [X0 + 4, X1 - 4]) for (const z of [Z0 + 4, zf - 4]) b.cyl(x, 0, z, feet, 2.2, 1.6);
  const { ix0, ix1, iy0, iy1 } = carcass(b, X0, X1, feet, h, Z0, zf - doorT, t);
  const nd = o.drawers ?? 0, doors = o.doors ?? 2, shelves = o.shelves ?? 1;
  const drawTop = iy1, drawBot = nd > 0 ? iy1 - fit((iy1 - iy0) * 0.3, 8, 15) : iy1;
  if (nd > 0) drawerRow(b, ix0, ix1, drawBot, drawTop, zf - doorT, zf, nd, pull);
  const open = shelves > 0 || doors === 0;
  const sections = doors + (open ? 1 : 0);
  const secW = (ix1 - ix0) / Math.max(1, sections);
  // the open section sits in the middle; doors fill the rest, half on each side
  const openIdx = open ? Math.floor(doors / 2) : -1;
  let di = 0;
  for (let i = 0; i < sections; i++) {
    const a = ix0 + secW * i, c = a + secW;
    if (i === openIdx) {
      b.as("Divider");
      if (i > 0) b.box(a - t / 2, a + t / 2, iy0, drawBot, Z0, zf - doorT);
      if (i < sections - 1) b.box(c - t / 2, c + t / 2, iy0, drawBot, Z0, zf - doorT);
      b.as("Shelf");
      for (let s = 1; s <= shelves; s++) {
        const y = iy0 + ((drawBot - iy0) * s) / (shelves + 1);
        b.box(a + t / 2, c - t / 2, y - t / 2, y + t / 2, Z0 + 1, zf - doorT - 1);
      }
    } else {
      door(b, a, c, iy0, drawBot, zf - doorT, zf, false, di < doors / 2, pull);
      di++;
    }
  }
}

// ---------------------------------------------------------------- altar ----
function altarTable(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const pull = fit(d * 0.03, 0.3, 1.2);
  const zf = Z1 - pull;
  const tiered = variant === "Two-Tier Altar";
  const mainH = tiered ? fit(h * 0.78, 50, h - 10) : h;
  const topT = fit(h * 0.035, 2.5, 4);
  const leg = fit(Math.min(w, d) * 0.08, 4, 7);
  b.as("Table top");
  b.box(X0, X1, mainH - topT, mainH, Z0, zf);
  fourLegs(b, X0, X1, Z0, zf, mainH - topT, leg, o.legs ?? "straight", 1.5);
  const nd = o.drawers ?? 0;
  const apronH = fit(mainH * 0.17, 10, 20);
  if (nd > 0) drawerRow(b, X0 + leg + 2, X1 - leg - 2, mainH - topT - apronH, mainH - topT, zf - 2, zf, nd, pull);
  else { b.as("Apron rail"); b.box(X0 + leg + 1.5, X1 - leg - 1.5, mainH - topT - apronH, mainH - topT, zf - 2, zf, "woodDeep"); }
  b.as("Lower shelf");
  b.box(X0 + leg + 1.5, X1 - leg - 1.5, mainH * 0.14, mainH * 0.14 + 2.2, Z0 + leg, zf - leg);
  if (tiered) {
    const rw = w * 0.62, rd = fit(d * 0.42, 12, d * 0.6);
    b.as("Upper tier");
    b.box(-rw / 2, rw / 2, mainH, h - topT, Z0, Z0 + rd, "woodDeep");
    b.as("Upper tier top");
    b.box(-rw / 2 - 2, rw / 2 + 2, h - topT, h, Z0, Z0 + rd + 1.5);
  }
}

// ----------------------------------------------------------------- desks ----
function studyDesk(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const pull = fit(d * 0.03, 0.3, 1.2);
  const zf = Z1 - pull;
  const topT = fit(h * 0.04, 2, 3.5);
  b.as("Desk top");
  b.box(X0, X1, h - topT, h, Z0, zf);
  if (variant === "Desk with Drawer Pedestal") {
    const pw = fit(w * 0.36, 30, 48);
    const t = 1.8;
    const { ix0, ix1, iy0, iy1 } = carcass(b, X1 - pw, X1, 0, h - topT, Z0, zf - 2, t);
    drawerStack(b, ix0, ix1, iy0, iy1, zf - 2, zf, o.drawers ?? 3, pull);
    b.as("Side panel");
    b.box(X0, X0 + t * 1.5, 0, h - topT, Z0, zf - 2);
    b.as("Modesty panel");
    b.box(X0 + t * 1.5, X1 - pw, h * 0.35, h - topT, Z0 + 1, Z0 + 2.6, "woodDeep");
    return;
  }
  const leg = fit(Math.min(w, d) * 0.07, 3.5, 5.5);
  fourLegs(b, X0, X1, Z0, zf, h - topT, leg, o.legs ?? "tapered", 1);
  const apronH = fit(h * 0.13, 7, 12);
  b.as("Apron rail");
  b.box(X0 + leg, X1 - leg, h - topT - apronH, h - topT, Z0 + 1, Z0 + 3, "woodDeep");
  const nd = o.drawers ?? 0;
  if (nd > 0) {
    const dw = Math.min(w * 0.3, 45) * nd;
    drawerRow(b, -dw / 2, dw / 2, h - topT - apronH, h - topT, zf - 2, zf, nd, pull);
    b.as("Apron rail");
    b.box(X0 + leg, -dw / 2, h - topT - apronH, h - topT, zf - 2, zf, "woodDeep");
    b.box(dw / 2, X1 - leg, h - topT - apronH, h - topT, zf - 2, zf, "woodDeep");
  } else b.box(X0 + leg, X1 - leg, h - topT - apronH, h - topT, zf - 2, zf, "woodDeep");
}

// ------------------------------------------------------------- headboard ----
function headboard(b: Builder, variant: string, { w, h, d }: Dims3) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const post = fit(w * 0.06, 5, 10);
  const cap = fit(h * 0.07, 4, 9);
  const lowRail = fit(h * 0.32, 15, h * 0.5);
  b.as("Post");
  b.box(X0, X0 + post, 0, h - cap, Z0, Z1);
  b.box(X1 - post, X1, 0, h - cap, Z0, Z1);
  b.as("Top cap rail");
  b.box(X0, X1, h - cap, h, Z0, Z1);
  b.as("Bottom rail");
  b.box(X0 + post, X1 - post, lowRail - cap * 0.8, lowRail, Z0 + d * 0.1, Z1 - d * 0.1);
  if (variant === "Slatted Headboard") {
    b.as("Slat");
    const inner = w - 2 * post, n = Math.max(5, Math.round(inner / 12));
    for (let i = 0; i < n; i++) {
      const cx = X0 + post + (inner * (i + 0.5)) / n;
      b.box(cx - 2.5, cx + 2.5, lowRail, h - cap, Z0 + d * 0.25, Z1 - d * 0.25);
    }
  } else {
    b.as("Headboard panel");
    b.box(X0 + post, X1 - post, lowRail, h - cap, Z0 + d * 0.2, Z1 - d * 0.35, "woodDeep");
    b.as("Raised panel face");
    const ins = fit(Math.min(w, h) * 0.06, 3, 8);
    b.box(X0 + post + ins, X1 - post - ins, lowRail + ins, h - cap - ins, Z0 + d * 0.2, Z1 - d * 0.15);
  }
}

// ------------------------------------------------------- drawer cabinets ----
function drawerCabinet(b: Builder, variant: string, { w, h, d }: Dims3, o: Opts) {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
  const pull = fit(d * 0.03, 0.3, 1.2);
  const zf = Z1 - pull;
  const legH = variant === "Bedside Table" ? fit(h * 0.2, 6, 18) : fit(h * 0.09, 5, 12);
  const leg = fit(Math.min(w, d) * 0.08, 3, 5.5);
  const t = fit(Math.min(w, h) * 0.03, 1.6, 2.5);
  fourLegs(b, X0, X1, Z0, zf - 2, legH + 0.01, leg, o.legs ?? "straight", 1);
  const { ix0, ix1, iy0, iy1 } = carcass(b, X0, X1, legH, h, Z0, zf - 2, t);
  const n = o.drawers ?? 3;
  if (variant === "Dresser" && n >= 4) {
    // two columns; an odd count puts one wide drawer on top
    const rows = Math.ceil(n / 2);
    const rowH = (iy1 - iy0) / rows;
    let y = iy0;
    for (let r = 0; r < rows; r++) {
      const single = n % 2 === 1 && r === rows - 1;
      if (single) drawerFront(b, ix0, ix1, y, y + rowH, zf - 2, zf, pull);
      else drawerRow(b, ix0, ix1, y, y + rowH, zf - 2, zf, 2, pull);
      y += rowH;
    }
  } else drawerStack(b, ix0, ix1, iy0, iy1, zf - 2, zf, n, pull);
}

/** All parts of the selected design, in cm, inside the exact W × H × D box. */
/** Categories whose builders are finished by fitToBox (the earlier five fit the box by construction). */
const FITTED: ReadonlySet<FurnitureCategory> = new Set(["Chair", "Bench", "TV Stand / Console", "Altar Table", "Study Desk", "Headboard", "Drawer Cabinet"]);
const SAFE_MIN = 30; // cm: below this a piece is built at 30 cm, then scaled down

/**
 * Scales parts so their bounds are exactly W × H × D (x centred, y from 0, z
 * centred). For sensible sizes the factors are ~1 and only remove rounding;
 * for extreme sizes the piece is stretched rather than broken.
 */
function fitToBox(parts: Part[], { w, h, d }: Dims3): Part[] {
  const { min, max } = partsBounds(parts);
  const k = [0, 1, 2].map((i) => (max[i] - min[i] > EPS ? [w, h, d][i] / (max[i] - min[i]) : 1));
  const o: V3 = [-w / 2, 0, -d / 2];
  const t = (p: V3): V3 => [o[0] + (p[0] - min[0]) * k[0], o[1] + (p[1] - min[1]) * k[1], o[2] + (p[2] - min[2]) * k[2]];
  return parts.map((p): Part => {
    if (p.shape === "box") return { ...p, min: t(p.min), max: t(p.max) };
    if (p.shape === "cyl") return { ...p, base: t(p.base), h: p.h * k[1], sx: (p.sx ?? 1) * k[0], sz: (p.sz ?? 1) * k[2] };
    return { ...p, center: t(p.center), r: p.r * Math.min(k[0], k[1]), len: p.len * k[2] };
  });
}

export function buildFurnitureParts(category: FurnitureCategory, variant: string, dims: Dims3): Part[] {
  if (FITTED.has(category)) {
    // tiny sizes are built at a workable size first, so no part is lost before scaling
    const safe = { w: Math.max(dims.w, SAFE_MIN), h: Math.max(dims.h, SAFE_MIN), d: Math.max(dims.d, SAFE_MIN) };
    const tiny = safe.w !== dims.w || safe.h !== dims.h || safe.d !== dims.d;
    return fitToBox(rawParts(category, variant, tiny ? safe : dims), dims);
  }
  return rawParts(category, variant, dims);
}

function rawParts(category: FurnitureCategory, variant: string, dims: Dims3): Part[] {
  const b = new Builder();
  // "Chest of Drawers · 6 drawers" -> the design name + its details (defaults filled in)
  const o = effectiveOptions(category, variant);
  const v = o.base;
  switch (category) {
    case "Panel Door": panelDoor(b, v, dims); break;
    case "Dining Table": diningTable(b, v, dims, o); break;
    case "Living Room Set": livingRoomSet(b, v, dims); break;
    case "Kitchen / Wall Cabinet": cabinet(b, v, dims, o); break;
    case "Chair": chair(b, v, dims, o); break;
    case "Bench": bench(b, v, dims, o); break;
    case "TV Stand / Console": tvConsole(b, v, dims, o); break;
    case "Altar Table": altarTable(b, v, dims, o); break;
    case "Study Desk": studyDesk(b, v, dims, o); break;
    case "Headboard": headboard(b, v, dims); break;
    case "Drawer Cabinet": drawerCabinet(b, v, dims, o); break;
    case "Custom Piece": customPiece(b, v, dims, o); break;
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

