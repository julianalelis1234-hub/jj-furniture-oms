"use client";

import { useId, type ReactNode } from "react";
import type { FurnitureCategory } from "@/lib/domain/furniture";
import { buildFurnitureParts, type Part } from "@/lib/domain/furniture3d";

const FITTED_2D: ReadonlySet<FurnitureCategory> = new Set(["Chair", "Bench", "TV Stand / Console", "Altar Table", "Study Desk", "Headboard", "Drawer Cabinet"]);
import type { WoodType } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export interface PreviewSpec {
  furniture_category: FurnitureCategory | null;
  design_variant: string | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  wood_type: WoodType;
  color_finish: string;
  /** the customer's own wood name when the wood is "Other" (e.g. Narra); shown instead of "Other" */
  wood_label?: string | null;
}

export const PREVIEW_DISCLAIMER = "Illustrative Visual Preview — Reference Aid Only (Not a Manufacturing or Engineering Drawing)";

// ------------------------------------------------------------ materials ----
const WOOD_HEX: Record<WoodType, string> = { Mahogany: "#8a4a2b", Gmelina: "#d9b57e", Other: "#a68664" };

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Surface, grain and sheen for each finish over the chosen wood. */
export function finishLook(wood: WoodType, finish: string) {
  const base = WOOD_HEX[wood] ?? WOOD_HEX.Other;
  switch (finish) {
    case "Walnut Stain":
      return { surface: mix(base, "#4a2c18", 0.62), grain: "#2a170c", grainOpacity: 0.32, sheen: "#f3c48e", sheenOpacity: 0.16, edge: "#2a170c", bevel: false };
    case "Gloss White":
      return { surface: "#f3eee5", grain: "#d8cfc2", grainOpacity: 0.0, sheen: "#ffffff", sheenOpacity: 0.55, edge: "#cfc4b5", bevel: true };
    case "Dark Espresso":
      return { surface: mix(base, "#1d130d", 0.84), grain: "#7a6758", grainOpacity: 0.2, sheen: "#d6c2ae", sheenOpacity: 0.1, edge: "#120c08", bevel: false };
    case "Natural Varnish":
    default:
      return { surface: base, grain: mix(base, "#3b200f", 0.55), grainOpacity: 0.36, sheen: "#ffd79a", sheenOpacity: 0.26, edge: mix(base, "#2a170c", 0.6), bevel: false };
  }
}

// ------------------------------------------------------------- geometry ----
interface Box { x: number; y: number; w: number; h: number }
type Shape = { kind: "rect"; x: number; y: number; w: number; h: number; r?: number; glass?: boolean; detail?: boolean }
  | { kind: "path"; d: string; glass?: boolean; detail?: boolean }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; detail?: boolean };

/**
 * Front view projected from the 3D parts (new furniture types, and any design
 * with details such as a drawer count): back parts first, so fronts cover them.
 */
function projectedParts(cat: FurnitureCategory, variant: string, w: number, h: number, d: number): Shape[] {
  const front = (p: Part) => (p.shape === "box" ? p.max[2] : p.shape === "cyl" ? p.base[2] : p.center[2] + p.len / 2);
  return buildFurnitureParts(cat, variant, { w, h, d })
    .sort((a, b) => front(a) - front(b))
    .map((p): Shape => {
      const detail = p.mat === "woodDeep" || p.mat === "brass";
      if (p.shape === "box") return { kind: "rect", x: p.min[0] + w / 2, y: h - p.max[1], w: p.max[0] - p.min[0], h: p.max[1] - p.min[1], glass: p.mat === "glass", detail };
      if (p.shape === "cyl") {
        const r = Math.max(p.rTop, p.rBottom) * (p.sx ?? 1);
        return { kind: "rect", x: p.base[0] - r + w / 2, y: h - p.base[1] - p.h, w: 2 * r, h: p.h, r: Math.min(r, 1), detail };
      }
      return { kind: "ellipse", cx: p.center[0] + w / 2, cy: h - p.center[1], rx: p.r, ry: p.r, detail };
    });
}

/** Front-elevation parts in a w×h box (cm units, y grows downward from the top). */
function parts(cat: FurnitureCategory, fullVariant: string, w: number, h: number, d: number): Shape[] {
  if (FITTED_2D.has(cat) || fullVariant.includes(" · ")) return projectedParts(cat, fullVariant, w, h, d);
  const variant = fullVariant;
  const s: Shape[] = [];
  const R = (x: number, y: number, ww: number, hh: number, extra: Partial<Extract<Shape, { kind: "rect" }>> = {}) =>
    s.push({ kind: "rect", x, y, w: ww, h: hh, ...extra });
  const m = Math.min(w, h);
  switch (cat) {
    case "Panel Door": {
      R(0, 0, w, h, { r: 0.6 });
      const f = Math.max(6, w * 0.12);
      if (variant === "Modern 4-Panel") {
        const ph = (h - f * 5) / 4;
        for (let i = 0; i < 4; i++) R(f, f + i * (ph + f), w - 2 * f, ph, { detail: true });
      } else if (variant === "Arch-Top Single Panel") {
        const top = f + (w - 2 * f) / 2;
        s.push({ kind: "path", detail: true, d: `M${f} ${h - f} V${top} A${(w - 2 * f) / 2} ${(w - 2 * f) / 2} 0 0 1 ${w - f} ${top} V${h - f} Z` });
      } else if (variant === "Glass-Inset Half Panel") {
        R(f, f, w - 2 * f, h * 0.45 - f, { glass: true });
        R(f, h * 0.45 + f, w - 2 * f, h * 0.55 - 2 * f, { detail: true });
      } else {
        R(f, f, w - 2 * f, h * 0.42 - f, { detail: true });
        R(f, h * 0.42 + f, w - 2 * f, h * 0.58 - 2 * f, { detail: true });
      }
      s.push({ kind: "ellipse", cx: w - f * 0.55, cy: h * 0.52, rx: 1.6, ry: 1.6, detail: true });
      break;
    }
    case "Dining Table": {
      const top = Math.max(3.5, h * 0.05);
      if (variant === "Round Pedestal") {
        R(0, 0, w, top, { r: top / 2 });
        R(w / 2 - w * 0.07, top, w * 0.14, h - top - 6);
        s.push({ kind: "path", d: `M${w / 2 - w * 0.26} ${h} Q${w / 2} ${h - 10} ${w / 2 + w * 0.26} ${h} Z` });
      } else {
        R(0, 0, w, top, { r: 1 });
        R(4, top, w - 8, Math.max(6, h * 0.1), { detail: true }); // apron
        const leg = Math.max(5, m * 0.07);
        const legs = variant === "8-Seater Banquet" ? 3 : 2;
        for (let i = 0; i < legs; i++) {
          const x = legs === 2 ? (i === 0 ? 6 : w - 6 - leg) : 6 + i * ((w - 12 - leg) / 2);
          R(x, top, leg, h - top);
        }
      }
      break;
    }
    case "Living Room Set": {
      const seatY = h * 0.52;
      const arm = Math.max(8, w * 0.07);
      R(arm, seatY, w - 2 * arm, h * 0.16, { r: 2 }); // seat rail
      const legH = h * 0.14;
      R(arm + 4, h - legH, 5, legH);
      R(w - arm - 9, h - legH, 5, legH);
      if (variant === "Classic Curved Armrest Set") {
        s.push({ kind: "path", d: `M0 ${h} V${seatY - h * 0.08} Q0 ${seatY - h * 0.22} ${arm * 1.4} ${seatY - h * 0.2} V${h} Z` });
        s.push({ kind: "path", d: `M${w} ${h} V${seatY - h * 0.08} Q${w} ${seatY - h * 0.22} ${w - arm * 1.4} ${seatY - h * 0.2} V${h} Z` });
      } else {
        R(0, seatY - h * 0.18, arm, h - seatY + h * 0.18);
        R(w - arm, seatY - h * 0.18, arm, h - seatY + h * 0.18);
      }
      // backrest: slats or panel
      const back = { x: arm, y: h * 0.06, w: w - 2 * arm, h: seatY - h * 0.06 };
      R(back.x, back.y, back.w, 4);
      const n = Math.max(5, Math.round(back.w / 14));
      for (let i = 0; i < n; i++) R(back.x + 4 + i * ((back.w - 12) / n), back.y + 4, Math.max(3, back.w / n - 6), back.h - 4, { detail: true });
      if (variant === "L-Shape Corner Frame") R(w * 0.62, seatY + h * 0.16, w * 0.38 - arm, h * 0.12, { detail: true });
      break;
    }
    case "Kitchen / Wall Cabinet": {
      const counter = variant === "3-Door Base Counter";
      if (counter) R(-3, 0, w + 6, Math.max(3, h * 0.05), { r: 0.8 });
      const y0 = counter ? Math.max(3, h * 0.05) : 0;
      R(0, y0, w, h - y0, { r: 0.6 });
      const doors = variant === "3-Door Base Counter" ? 3 : 2;
      const g = Math.max(2, w * 0.015);
      if (variant === "Glass-Front Display Hutch") {
        const split = y0 + (h - y0) * 0.55;
        for (let i = 0; i < 2; i++) R(g + i * (w / 2), y0 + g, w / 2 - 2 * g, split - y0 - 2 * g, { glass: true });
        for (let i = 0; i < 2; i++) R(g + i * (w / 2), split + g, w / 2 - 2 * g, h - split - 2 * g, { detail: true });
      } else {
        for (let i = 0; i < doors; i++) R(g + i * (w / doors), y0 + g, w / doors - 2 * g, h - y0 - 2 * g, { detail: true });
      }
      for (let i = 1; i < (variant === "3-Door Base Counter" ? 3 : 2); i++) s.push({ kind: "ellipse", cx: i * (w / (variant === "3-Door Base Counter" ? 3 : 2)) - 3, cy: y0 + (h - y0) * 0.5, rx: 1.3, ry: 1.3, detail: true });
      break;
    }
    case "Custom Piece": {
      if (variant === "Bed Frame") {
        R(0, 0, Math.max(6, w * 0.05), h, { r: 1 });
        R(w - Math.max(6, w * 0.05), 0, Math.max(6, w * 0.05), h, { r: 1 });
        R(0, h * 0.06, w, h * 0.5, { detail: true }); // headboard
        R(0, h * 0.7, w, h * 0.12); // side rail
      } else if (variant === "Wardrobe / Aparador") {
        R(0, 0, w, h, { r: 0.6 });
        R(2, 2, w / 2 - 3, h * 0.86, { detail: true });
        R(w / 2 + 1, 2, w / 2 - 3, h * 0.86, { detail: true });
        R(2, h * 0.88, w - 4, h * 0.1, { detail: true });
        s.push({ kind: "ellipse", cx: w / 2 - 4, cy: h * 0.45, rx: 1.4, ry: 1.4, detail: true });
        s.push({ kind: "ellipse", cx: w / 2 + 4, cy: h * 0.45, rx: 1.4, ry: 1.4, detail: true });
      } else {
        const t = Math.max(2.5, w * 0.03);
        R(0, 0, t, h);
        R(w - t, 0, t, h);
        const shelves = Math.max(3, Math.round(h / 38));
        for (let i = 0; i <= shelves; i++) R(0, Math.min(h - t, i * ((h - t) / shelves)), w, t);
      }
      break;
    }
  }
  return s;
}


/** Vertical span (cm from the top) of the right-hand oblique side face. */
function sideFace(cat: string, variant: string, h: number): [number, number] {
  if (cat === "Dining Table") return [0, Math.max(3.5, h * 0.05)];
  if (cat === "Living Room Set") return [h * 0.52 - h * 0.18, h * 0.86];
  if (cat === "Custom Piece" && variant === "Bed Frame") return [0, h * 0.82];
  return [0, h];
}

function Arrow({ x1, y1, x2, y2, label, side = "below", marker }: { x1: number; y1: number; x2: number; y2: number; label: string; side?: "below" | "right" | "diag"; marker: string }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g className="jj-dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} />
      <text
        x={side === "right" ? mx + 6 : side === "diag" ? x2 + 4 : mx}
        y={side === "below" ? my + 13 : side === "diag" ? y2 - 3 : my}
        textAnchor={side === "below" ? "middle" : "start"}
        dominantBaseline={side === "right" ? "middle" : "auto"}
      >
        {label}
      </text>
    </g>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function FurniturePreview({
  spec,
  legacyDimensions,
  compact = false,
  className,
  footer,
}: {
  spec: PreviewSpec;
  legacyDimensions?: string | null;
  compact?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  const uid = useId().replace(/[:]/g, "");
  const look = finishLook(spec.wood_type, spec.color_finish);
  const { width_cm: w, height_cm: h, depth_cm: d, furniture_category: cat, design_variant: variant } = spec;
  const pending = w == null || h == null || d == null || !cat || !variant;

  // canvas: 340 × 230 view units; the furniture alone, centred
  const VW = 340, VH = 230, pad = 18;
  let body: ReactNode = null;
  if (!pending) {
    const depthDx = Math.min(d, 120) * 0.42, depthDy = Math.min(d, 120) * 0.24; // oblique depth (cm → cm)
    const sceneWcm = w + depthDx;
    const sceneHcm = h + depthDy + 4;
    const groundY = VH - pad - 14;
    const topReserve = 40; // keeps the wood/finish chip and the D label clear of the drawing
    const sc = Math.min((VW - 2 * pad - 50) / sceneWcm, (groundY - topReserve) / sceneHcm);
    const fx = pad + Math.max(0, (VW - 2 * pad - 50 - sceneWcm * sc) / 2); // furniture left, centred
    const box: Box = { x: fx, y: groundY - h * sc, w: w * sc, h: h * sc };
    const odx = depthDx * sc, ody = depthDy * sc;
    const shapes = parts(cat!, variant!, w, h, d);
    // pieces drawn from the 3D parts (chairs, desks, …) are open frames: no solid box faces around them
    const projected = FITTED_2D.has(cat!) || variant!.includes(" · ");
    // the visible side face: open frames (tables, sofas, beds) only show their top/arm/rail thickness
    const [sideFrom, sideTo] = sideFace(cat!, variant!, h);
    const toPx = (x: number, y: number) => [box.x + x * sc, box.y + y * sc] as const;
    const scalePath = (dstr: string) =>
      dstr.replace(/([MLHVQAZmlhvqaz])([^MLHVQAZmlhvqaz]*)/g, (_, cmd: string, args: string) => {
        const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
        const C = cmd.toUpperCase();
        if (C === "H") return `H${n.map((v) => box.x + v * sc).join(" ")}`;
        if (C === "V") return `V${n.map((v) => box.y + v * sc).join(" ")}`;
        if (C === "A") return `A${n[0] * sc} ${n[1] * sc} ${n[2]} ${n[3]} ${n[4]} ${box.x + n[5] * sc} ${box.y + n[6] * sc}`;
        if (C === "Z") return "Z";
        const out: number[] = [];
        for (let i = 0; i < n.length; i += 2) out.push(box.x + n[i] * sc, box.y + n[i + 1] * sc);
        return `${C}${out.join(" ")}`;
      });
    const surfaceStyle = { fill: look.surface, transition: "fill 200ms ease-out, stroke 200ms ease-out" };
    body = (
      <>
        {/* ground */}
        <line x1={pad - 4} y1={groundY} x2={VW - pad + 4} y2={groundY} className="jj-ground" />
        {/* oblique depth faces (top + side) */}
        {!projected && cat !== "Living Room Set" && <path d={`M${box.x} ${box.y} l${odx} ${-ody} h${box.w} l${-odx} ${ody} Z`} style={{ ...surfaceStyle, fill: mix(look.surface, "#ffffff", 0.16) }} stroke={look.edge} strokeWidth={0.8} />}
        {!projected && <path d={`M${box.x + box.w} ${box.y + sideFrom * sc} l${odx} ${-ody} v${(sideTo - sideFrom) * sc} l${-odx} ${ody} Z`} style={{ ...surfaceStyle, fill: mix(look.surface, "#000000", 0.22) }} stroke={look.edge} strokeWidth={0.8} />}
        {/* front parts */}
        <g stroke={look.edge} strokeWidth={0.9} style={{ transition: "stroke 200ms ease-out" }}>
          {shapes.map((p, i) => {
            const fill = p.kind !== "ellipse" && "glass" in p && p.glass ? "url(#" + uid + "-glass)" : p.detail ? mix(look.surface, "#000000", 0.08) : look.surface;
            const style = { ...surfaceStyle, fill };
            if (p.kind === "rect") {
              const [x, y] = toPx(p.x, p.y);
              return <rect key={i} x={x} y={y} width={Math.max(0.5, p.w * sc)} height={Math.max(0.5, p.h * sc)} rx={(p.r ?? 0) * sc} style={style} />;
            }
            if (p.kind === "ellipse") {
              const [cx, cy] = toPx(p.cx, p.cy);
              return <ellipse key={i} cx={cx} cy={cy} rx={Math.max(1.2, p.rx * sc)} ry={Math.max(1.2, p.ry * sc)} style={{ ...style, fill: look.bevel ? "#b8864b" : mix(look.surface, "#000", 0.45) }} />;
            }
            return <path key={i} d={scalePath(p.d)} style={style} />;
          })}
        </g>
        {/* grain + sheen overlays clipped to the front */}
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={`url(#${uid}-grain)`} style={{ opacity: look.grainOpacity, transition: "opacity 200ms ease-out" }} pointerEvents="none" mask={`url(#${uid}-mask)`} />
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={`url(#${uid}-sheen)`} style={{ opacity: look.sheenOpacity, transition: "opacity 200ms ease-out" }} pointerEvents="none" mask={`url(#${uid}-mask)`} />
        {look.bevel && <rect x={box.x + 0.8} y={box.y + 0.8} width={Math.max(0, box.w - 1.6)} height={Math.max(0, box.h - 1.6)} fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={0.8} />}
        <mask id={`${uid}-mask`}>
          <g fill="white">
            {shapes.map((p, i) => {
              if (p.kind === "rect") { const [x, y] = toPx(p.x, p.y); return <rect key={i} x={x} y={y} width={p.w * sc} height={p.h * sc} />; }
              if (p.kind === "path") return <path key={i} d={scalePath(p.d)} />;
              return null;
            })}
          </g>
        </mask>
        {/* dimension arrows */}
        <Arrow x1={box.x} y1={groundY + 8} x2={box.x + box.w} y2={groundY + 8} label={`W ${fmt(w)} cm`} marker={`${uid}-arrow`} />
        <Arrow x1={box.x + box.w + odx + 12} y1={box.y} x2={box.x + box.w + odx + 12} y2={groundY} label={`H ${fmt(h)} cm`} side="right" marker={`${uid}-arrow`} />
        <Arrow x1={box.x + 3} y1={box.y - 4} x2={box.x + odx + 3} y2={box.y - ody - 4} label={`D ${fmt(d)} cm`} side="diag" marker={`${uid}-arrow`} />
      </>
    );
  }

  return (
    <figure className={cn("overflow-hidden rounded-xl border bg-card", className)} aria-label="Illustrative furniture preview">
      {!compact && (
        <figcaption className="border-b bg-secondary/60 px-3 py-2 text-[0.7rem] leading-snug font-semibold text-muted-foreground">
          {PREVIEW_DISCLAIMER}
        </figcaption>
      )}
      <div className="relative">
        {pending ? (
          <div className="flex aspect-[340/230] flex-col items-center justify-center gap-1 bg-muted/60 p-4 text-center">
            <p className="font-semibold">Dimensions Pending Clarification</p>
            <p className="text-sm text-muted-foreground">
              {legacyDimensions ? <>Recorded on the slip: <span className="tabular-nums">{legacyDimensions}</span></> : "Choose a category, design and W × H × D."}
            </p>
          </div>
        ) : (
          <svg viewBox={`0 0 ${VW} ${VH}`} className="block h-auto w-full" role="img" aria-label={`${variant} ${cat}, ${fmt(w!)} by ${fmt(h!)} by ${fmt(d!)} centimetres, ${spec.wood_type}, ${spec.color_finish}`}>
            <defs>
              <pattern id={`${uid}-grain`} width="44" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(2)">
                <path d="M0 4 C11 1 22 7 44 4 M0 10 C14 8 26 13 44 10 M0 14.5 C10 13 30 16 44 14" fill="none" stroke={look.grain} strokeWidth="0.9" />
              </pattern>
              <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={look.sheen} stopOpacity="0.9" />
                <stop offset="0.35" stopColor={look.sheen} stopOpacity="0" />
                <stop offset="0.7" stopColor={look.sheen} stopOpacity="0" />
                <stop offset="1" stopColor={look.sheen} stopOpacity="0.45" />
              </linearGradient>
              <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#dbe9ef" />
                <stop offset="0.5" stopColor="#b9d0da" />
                <stop offset="1" stopColor="#e8f1f4" />
              </linearGradient>
              <marker id={`${uid}-arrow`} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" className="jj-arrow-head" />
              </marker>
            </defs>
            {body}
          </svg>
        )}
        <span data-wood-chip className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full border bg-card/90 px-2 py-0.5 text-[0.7rem] font-bold">
          <span className="size-2.5 rounded-full border" style={{ background: WOOD_HEX[spec.wood_type] }} aria-hidden />
          {spec.wood_label || spec.wood_type}
          <span className="font-normal text-muted-foreground">· {spec.color_finish}</span>
        </span>
      </div>
      {footer}
    </figure>
  );
}
