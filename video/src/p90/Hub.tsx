import { ClipboardList, Crown, Hammer, ShoppingBag, Truck } from "lucide-react";
import React from "react";
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import { C, ease, FPS, mix, sans, serif } from "../theme";

/** The 1:30 cut's motion standard. */
export const SPRING90 = { damping: 18, stiffness: 125, mass: 0.85 };

export const HUB_ROLES = [
  { name: "Owner", code: "O-01", icon: Crown },
  { name: "Staff", code: "S-01", icon: ClipboardList },
  { name: "Craftsmen", code: "C-01", icon: Hammer },
  { name: "Delivery Rider", code: "D-01", icon: Truck },
  { name: "Customer", code: "CU-01", icon: ShoppingBag },
] as const;
export type HubRole = (typeof HUB_ROLES)[number]["name"];

const R = 112;
const CX = 960;
const CY = 540;
/** fixed pentagon (slow drift added at render time) so returns to the hub feel familiar */
const BASE = HUB_ROLES.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / HUB_ROLES.length);
export function bubblePos(i: number, t: number) {
  const a = BASE[i] + t * 0.05; // slow orbital drift
  return { x: CX + Math.cos(a) * 470, y: CY + 20 + Math.sin(a) * 300 + Math.sin(t * 1.3 + i) * 7 };
}

/** The recording cursor (caramel ring + cream dot), drawn in Remotion. */
export const Cursor: React.FC<{ x: number; y: number; press?: number; opacity?: number }> = ({ x, y, press = 0, opacity = 1 }) => (
  <div style={{ position: "absolute", left: x - 17, top: y - 17, width: 34, height: 34, borderRadius: 99, border: `3px solid ${C.caramel}`, background: "rgba(196,138,90,0.22)", boxShadow: "0 0 0 2px rgba(43,29,23,0.55), 0 4px 14px rgba(0,0,0,0.45)", scale: String(1 - 0.22 * press), opacity, pointerEvents: "none" }}>
    <div style={{ position: "absolute", left: 13, top: 13, width: 6, height: 6, borderRadius: 99, background: C.cream }} />
  </div>
);
/** Caramel click ripple: scale 0 -> 2.2, opacity 0.6 -> 0 */
export const Ripple: React.FC<{ x: number; y: number; at: number; t: number }> = ({ x, y, at, t }) => {
  const p = (t - at) / 0.65;
  if (p < 0 || p > 1) return null;
  const e = ease(p);
  return <div style={{ position: "absolute", left: x - 18, top: y - 18, width: 36, height: 36, borderRadius: 99, border: `2px solid ${C.caramel}`, background: "rgba(196,138,90,0.35)", scale: String(2.2 * e), opacity: 0.6 * (1 - e), pointerEvents: "none" }} />;
};

/**
 * Floating 5-roles hub. Local timeline:
 *  - `popAt` (optional): bubbles pop in every 0.25 s (otherwise they are already there)
 *  - `hoverAt`: the cursor glides onto `target` (bubble glows 1.0 -> 1.12)
 *  - `clickAt`: ripple, then the camera dives through the target bubble (1.0 -> 4.5x, radial blur)
 */
export const Hub: React.FC<{ target: HubRole; popAt?: number; hoverAt: number; clickAt: number; diveDur?: number; title?: string }> = ({ target, popAt, hoverAt, clickAt, diveDur = 1.5, title }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const ti = HUB_ROLES.findIndex((r) => r.name === target);
  const dive = ease((t - clickAt) / diveDur);
  const tp = bubblePos(ti, t);
  const hover = ease((t - (hoverAt + 0.6)) / 0.4);
  // cursor path: from lower centre, gliding with a gentle arc onto the target
  const g = ease((t - hoverAt) / 0.9);
  const cx = mix(CX + 40, tp.x + 26, g);
  const cy = mix(CY + 330, tp.y + 30, g) - Math.sin(Math.PI * g) * 40;
  const press = Math.max(0, 1 - Math.abs(t - clickAt) / 0.13);
  const titleP = ease((t - (popAt ?? -1) - 0.1) / 0.7);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 760px at 50% 50%, #3a271f 0%, ${C.espresso} 70%)`, overflow: "hidden" }}>
      {/* the whole hub dives toward the target */}
      <AbsoluteFill style={{ transformOrigin: `${tp.x}px ${tp.y}px`, scale: String(mix(1, 4.5, dive)), filter: dive > 0.02 ? `blur(${10 * dive}px)` : undefined, opacity: 1 - ease((t - clickAt - diveDur * 0.55) / (diveDur * 0.45)) }}>
        <div style={{ position: "absolute", left: CX - 520, top: CY - 300, width: 1040, height: 640, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(196,138,90,0.16), transparent)" }} />
        <div style={{ position: "absolute", top: 64, width: "100%", textAlign: "center", opacity: titleP }}>
          <div style={{ fontFamily: sans, fontWeight: 700, letterSpacing: 5, fontSize: 21, color: C.caramel, textTransform: "uppercase" }}>One shared, live order record</div>
          <div style={{ fontFamily: serif, fontSize: 56, color: C.cream, marginTop: 4 }}>{title ?? "Five roles, always in sync"}</div>
        </div>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {HUB_ROLES.map((_, i) => {
            const a = bubblePos(i, t);
            const b = bubblePos((i + 1) % 5, t);
            const c = bubblePos((i + 2) % 5, t);
            const pulse = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.6 - i));
            return (
              <g key={i} opacity={popAt === undefined ? 1 : ease((t - popAt - 1.2) / 0.6)}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={C.caramel} strokeOpacity={pulse} strokeDasharray="6 10" strokeDashoffset={-t * 30} />
                <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke={C.caramel} strokeOpacity={pulse * 0.6} strokeDasharray="4 12" strokeDashoffset={-t * 24} />
              </g>
            );
          })}
        </svg>
        {HUB_ROLES.map((r, i) => {
          const p = bubblePos(i, t);
          const Icon = r.icon;
          const s = popAt === undefined ? 1 : spring({ frame: frame - Math.round((popAt + i * 0.25) * FPS), fps: FPS, config: SPRING90 });
          const isT = i === ti;
          const glow = isT ? hover : 0;
          return (
            <div key={r.name} style={{ position: "absolute", left: p.x - R, top: p.y - R, width: R * 2, height: R * 2, borderRadius: "50%", scale: String(s * (1 + 0.12 * glow)), opacity: Math.min(1, s * 1.5) * (isT ? 1 : 1 - 0.5 * hover), background: "radial-gradient(circle at 35% 30%, rgba(250,246,240,0.10), rgba(54,37,30,0.8) 55%, rgba(43,29,23,0.92))", border: `1.5px solid ${C.caramel}`, boxShadow: `0 0 ${30 + 40 * glow}px rgba(196,138,90,${0.3 + 0.4 * glow}), inset 0 0 ${30 + 20 * glow}px rgba(196,138,90,${0.18 + 0.2 * glow})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Icon size={52} color={C.caramel} strokeWidth={1.6} />
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: r.name.length > 10 ? 23 : 27, color: C.cream }}>{r.name}</div>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 17, letterSpacing: 2, color: C.latte, opacity: 0.85 }}>{r.code}</div>
            </div>
          );
        })}
        <Ripple x={tp.x} y={tp.y} at={clickAt} t={t} />
      </AbsoluteFill>
      <Cursor x={cx} y={cy} press={press} opacity={ease((t - hoverAt + 0.3) / 0.3) * (1 - dive)} />
    </AbsoluteFill>
  );
};
