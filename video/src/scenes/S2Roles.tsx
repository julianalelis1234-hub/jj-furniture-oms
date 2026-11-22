import { ClipboardList, Crown, Hammer, ShoppingBag, Truck } from "lucide-react";
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";
import { C, ease, FPS, mix, sans, serif, SPRING } from "../theme";

export const ROLES = [
  { name: "Owner", code: "O-01", icon: Crown, note: "approvals · priorities" },
  { name: "Staff", code: "S-01", icon: ClipboardList, note: "quotes · payments" },
  { name: "Craftsman", code: "C-01", icon: Hammer, note: "workshop · phones" },
  { name: "Delivery Driver", code: "D-01", icon: Truck, note: "trips · cash" },
  { name: "Customer", code: "CU-01", icon: ShoppingBag, note: "design · track" },
];
/** bubble entrance times (scene-local seconds); also used for the pop SFX */
export const BUBBLE_IN = ROLES.map((_, i) => 0.8 + i * 0.45);
export const ZOOM_AT = 15.3; // zoom-through starts (global 29.5)

const R = 118; // bubble radius
const CX = 960;
const CY = 520;

/** 0:15 – 0:32 · the 5-role ecosystem orbit, ending in a zoom-through on the Customer bubble. */
export const S2Roles: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const z = ease((t - ZOOM_AT) / 2.2); // 0..1 zoom-through
  const orbit = interpolate(t, [3.5, 15.3], [0, Math.PI * 2 * 0.62], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => ease(x * 1.02) });
  const pos = ROLES.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / ROLES.length + orbit;
    const depth = (Math.sin(a) + 1) / 2; // 0 back .. 1 front
    return { x: CX + Math.cos(a) * 560, y: CY + Math.sin(a) * 250, depth };
  });
  const cust = pos[4];
  // the customer bubble glides to centre and grows to 4.5x
  const custX = mix(cust.x, CX, ease((t - ZOOM_AT) / 1.2));
  const custY = mix(cust.y, CY + 20, ease((t - ZOOM_AT) / 1.2));
  const titleP = ease((t - 0.2) / 0.9);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 45%, #3a271f 0%, ${C.espresso} 70%)`, overflow: "hidden" }}>
      {/* soft caramel haze */}
      <div style={{ position: "absolute", left: CX - 520, top: CY - 300, width: 1040, height: 600, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(196,138,90,0.16), transparent)", opacity: 0.8 + 0.2 * Math.sin(t) }} />
      <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", opacity: titleP * (1 - z), translate: `0 ${(1 - titleP) * 18}px` }}>
        <div style={{ fontFamily: sans, fontWeight: 700, letterSpacing: 5, fontSize: 22, color: C.caramel, textTransform: "uppercase" }}>One shared order record</div>
        <div style={{ fontFamily: serif, fontSize: 64, color: C.cream, marginTop: 6 }}>Five portals, always in sync</div>
      </div>

      {/* connector lines */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: (1 - z) * ease((t - 3.0) / 1.2) }}>
        {pos.map((p, i) =>
          pos.slice(i + 1).map((q, j) => {
            const pulse = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.4 - (i + j) * 0.9));
            return <line key={`${i}-${j}`} x1={p.x} y1={p.y} x2={i === 4 ? custX : q.x} y2={q.y} stroke={C.caramel} strokeWidth={1} strokeOpacity={pulse} strokeDasharray="6 10" strokeDashoffset={-t * 30} />;
          }),
        )}
      </svg>

      {[...ROLES.keys()]
        .sort((a, b) => pos[a].depth - pos[b].depth)
        .map((i) => {
          const r = ROLES[i];
          const Icon = r.icon;
          const isCust = i === 4;
          const s = spring({ frame: frame - Math.round(BUBBLE_IN[i] * FPS), fps: FPS, config: SPRING });
          const bob = Math.sin(t * 1.3 + i) * 8;
          const depthScale = 0.86 + 0.2 * pos[i].depth;
          const x = isCust ? custX : pos[i].x;
          const y = (isCust ? custY : pos[i].y) + bob * (1 - z);
          const scale = s * depthScale * (isCust ? mix(1, 4.5, ease((t - ZOOM_AT - 0.4) / 1.8)) : 1);
          const fade = isCust ? 1 - ease((t - ZOOM_AT - 1.2) / 1.0) : 1 - z;
          return (
            <div
              key={r.name}
              style={{
                position: "absolute",
                left: x - R,
                top: y - R,
                width: R * 2,
                height: R * 2,
                borderRadius: "50%",
                scale: String(scale),
                opacity: fade * Math.min(1, s * 1.5),
                background: "radial-gradient(circle at 35% 30%, rgba(250,246,240,0.10), rgba(54,37,30,0.78) 55%, rgba(43,29,23,0.9))",
                border: `1.5px solid ${C.caramel}`,
                boxShadow: `0 0 ${30 + 20 * pos[i].depth}px rgba(196,138,90,${0.25 + 0.2 * pos[i].depth}), inset 0 0 30px rgba(196,138,90,0.18)`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                filter: isCust && z > 0 ? `blur(${12 * ease((t - ZOOM_AT - 0.6) / 1.4)}px)` : undefined,
                zIndex: Math.round(pos[i].depth * 10) + (isCust && z > 0 ? 50 : 0),
              }}
            >
              <Icon size={54} color={C.caramel} strokeWidth={1.6} />
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: r.name.length > 10 ? 23 : 27, color: C.cream }}>{r.name}</div>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 17, letterSpacing: 2, color: C.latte, opacity: 0.85 }}>{r.code}</div>
            </div>
          );
        })}
    </AbsoluteFill>
  );
};
