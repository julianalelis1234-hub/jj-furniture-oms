import React from "react";
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import { Tree } from "../components/Tree";
import { C, ease, FPS, sans, serif, SPRING, wordmark } from "../theme";

const PILLARS = ["Real-Time 7-Stage Tracking", "3D Custom Configurator", "30% Gate & RLS Security"];

/** 3:17 – 3:30 · brand mark, tagline, the three pillars, fade to Espresso. Local 0 = 197 s. */
export const S9Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const mark = ease((t - 1.0) / 1.2);
  const word = ease((t - 1.6) / 1.0);
  const tag = ease((t - 2.4) / 1.0);
  const out = 1 - ease((t - 11.5) / 1.5);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(900px 620px at 50% 42%, rgba(196,138,90,${0.22 + 0.05 * Math.sin(t * 1.2)}) 0%, ${C.espresso} 68%)`, alignItems: "center", justifyContent: "center", opacity: out }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -40 }}>
        <div style={{ opacity: mark, scale: String(0.92 + 0.08 * mark) }}>
          <Tree size={190} glow={1.2} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 18, opacity: word, translate: `0 ${(1 - word) * 16}px` }}>
          <span style={{ fontFamily: wordmark, fontWeight: 900, fontSize: 84, color: C.cream, letterSpacing: -1 }}>JJ Furniture</span>
          <span style={{ fontFamily: wordmark, fontWeight: 800, fontSize: 34, color: C.latte, letterSpacing: 1.5 }}>Shop and Enterprises</span>
        </div>
        <div style={{ marginTop: 14, fontFamily: serif, fontStyle: "italic", fontSize: 38, color: C.latte, opacity: tag, letterSpacing: 1 }}>
          Modern • Warm • Luxurious — Valencia City, Bukidnon
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 46 }}>
          {PILLARS.map((p, i) => {
            const s = spring({ frame: frame - Math.round((6.0 + i * 0.35) * FPS), fps: FPS, config: SPRING });
            return (
              <React.Fragment key={p}>
                {i > 0 && <div style={{ width: 1, height: 38, background: C.caramel, margin: "0 22px", opacity: s }} />}
                <div style={{ padding: "12px 26px", borderRadius: 999, border: `1px solid ${C.caramel}`, background: "rgba(54,37,30,0.8)", fontFamily: sans, fontWeight: 700, fontSize: 24, color: C.cream, opacity: s, translate: `0 ${(1 - s) * 20}px` }}>
                  {p}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
