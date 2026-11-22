import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, ease, FPS, sans, serif } from "../theme";

/** Top-left scene chip: which portal we are looking at. */
export const RoleChip: React.FC<{ role: string; label: string; delay?: number }> = ({ role, label, delay = 0.6 }) => {
  const t = useCurrentFrame() / FPS;
  const p = ease((t - delay) / 0.7);
  return (
    <AbsoluteFill style={{ padding: "34px 44px", pointerEvents: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, opacity: p, translate: `${(1 - p) * -24}px 0px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderRadius: 999, background: "rgba(43,29,23,0.88)", border: `1.5px solid ${C.caramel}`, boxShadow: "0 0 24px rgba(196,138,90,0.25)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: C.caramel, boxShadow: `0 0 ${8 + 6 * Math.sin(t * 4)}px ${C.caramel}` }} />
          <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 22, letterSpacing: 1.5, textTransform: "uppercase", color: C.cream }}>{role}</span>
        </div>
        <span style={{ fontFamily: serif, fontSize: 30, color: C.latte, textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>{label}</span>
      </div>
    </AbsoluteFill>
  );
};

/** Caramel outline pulse around a UI element (clip pixels, inside the Camera). */
export const Highlight: React.FC<{ box: { x: number; y: number; width: number; height: number }; at: number; hold?: number; pad?: number; radius?: number }> = ({ box, at, hold = 4, pad = 8, radius = 16 }) => {
  const t = useCurrentFrame() / FPS;
  const p = Math.min(ease((t - at) / 0.5), 1 - ease((t - at - hold) / 0.6));
  if (p <= 0) return null;
  const pulse = 0.5 + 0.5 * Math.sin((t - at) * 5);
  return (
    <div
      style={{
        position: "absolute",
        left: box.x - pad,
        top: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
        borderRadius: radius,
        border: `3px solid ${C.caramel}`,
        boxShadow: `0 0 ${18 + 16 * pulse}px rgba(196,138,90,${0.45 + 0.3 * pulse}), inset 0 0 18px rgba(196,138,90,0.18)`,
        opacity: p,
        pointerEvents: "none",
      }}
    />
  );
};
