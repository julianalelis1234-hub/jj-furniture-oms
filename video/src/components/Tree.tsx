import React from "react";
import { useCurrentFrame } from "remotion";
import { C, FPS } from "../theme";

/** The app's swaying-tree mark (same SVG), animated frame-by-frame in dark-mode colours. */
export const Tree: React.FC<{ size?: number; glow?: number }> = ({ size = 220, glow = 1 }) => {
  const t = useCurrentFrame() / FPS;
  const sway = (period: number, phase: number) => 2.5 * Math.sin(((t + phase) / period) * Math.PI);
  const drift = (period: number, phase: number) => {
    const p = (((t + phase) % period) + period) % period / period;
    const o = p < 0.15 ? (p / 0.15) * 0.85 : p > 0.85 ? (1 - p) / 0.15 * 0.6 : 0.85 - (p - 0.15) * 0.36;
    return { o, x: -14 * p, y: 46 * p, r: -70 * p };
  };
  const d1 = drift(6.5, 0);
  const d2 = drift(5.5, 3);
  const canopy = (deg: number, cy: number): React.CSSProperties => ({ transformBox: "fill-box", transformOrigin: "50% 100%", transform: `rotate(${deg}deg)`, translate: `0 ${cy}px` });
  return (
    <svg viewBox="0 0 120 140" width={size} height={(size * 140) / 120} style={{ overflow: "visible", filter: `drop-shadow(0 0 ${28 * glow}px rgba(196,138,90,${0.35 * glow}))` }}>
      <path d="M18 134 H102" stroke={C.border} strokeWidth={1.5} strokeLinecap="round" />
      <path
        fill={C.latte}
        d="M56 134 C57 118 56 104 54 92 C51 84 46 80 42 76 L45 74 C50 78 54 82 57 86 C58 78 58 70 57 62 L63 62 C62 72 62 80 63 86 C66 81 71 77 76 74 L78 76 C73 80 68 85 66 92 C64 104 63 118 64 134 Z"
      />
      <g style={canopy(sway(6.5, 0), 0)}>
        <ellipse cx="60" cy="44" rx="40" ry="30" fill={C.mocha} />
      </g>
      <g style={canopy(sway(5.5, -1.4), 0)}>
        <ellipse cx="44" cy="58" rx="26" ry="19" fill={C.caramel} />
        <ellipse cx="78" cy="56" rx="27" ry="20" fill={C.caramel} />
      </g>
      <g style={canopy(sway(4.5, -2.6), 0)}>
        <ellipse cx="60" cy="36" rx="25" ry="19" fill={C.latte} />
        <path d="M60 20 C61 28 61 36 60 46" stroke={C.espresso} strokeOpacity={0.45} strokeWidth={1.2} fill="none" strokeLinecap="round" />
      </g>
      <path d="M88 70 c4 -3 9 -2 10 2 c-4 3 -9 2 -10 -2 z" fill={C.caramel} opacity={d1.o} style={{ transformBox: "fill-box", transformOrigin: "center", transform: `translate(${d1.x}px, ${d1.y}px) rotate(${d1.r}deg)` }} />
      <path d="M30 66 c3 -3 8 -3 9 1 c-3 3 -8 3 -9 -1 z" fill={C.caramel} opacity={d2.o} style={{ transformBox: "fill-box", transformOrigin: "center", transform: `translate(${d2.x}px, ${d2.y}px) rotate(${d2.r}deg)` }} />
    </svg>
  );
};
