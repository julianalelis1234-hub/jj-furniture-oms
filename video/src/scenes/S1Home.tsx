import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Camera } from "../components/Camera";
import { WarpedClip } from "../components/WarpedClip";
import { C, ease, FPS, sans, serif } from "../theme";

/** 0:00 – 0:15 · fade in on the real dark homepage, title reveal, slow Ken Burns push. */
export const S1Home: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const fadeIn = ease(t / 2.2);
  const rise = ease((t - 2.5) / 1.1);
  const blur = 8 * (1 - ease((t - 2.5) / 1.2));
  const line = ease((t - 3.2) / 0.8);
  const titleOut = 1 - ease((t - 10.5) / 1.4);
  const scrim = Math.min(ease((t - 2.2) / 1.0), titleOut * 0.6 + 0.4);
  return (
    <AbsoluteFill style={{ backgroundColor: C.espresso }}>
      <Camera
        drift={0}
        shots={[
          { at: 0, dur: 0.01, scale: 1.04, cx: 960, cy: 420 },
          { at: 0.02, dur: 2.5, scale: 1.0, cx: 960, cy: 420 },
          { at: 6.0, dur: 9.0, scale: 1.05, cx: 960, cy: 380 },
        ]}
      >
        <WarpedClip name="s1-home" anchors={[[0.2, 0], [15.6, 15.4]]} />
      </Camera>
      {/* lower-third scrim + title */}
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(43,29,23,0.97) 0%, rgba(43,29,23,0.9) 26%, rgba(43,29,23,0) 52%)", opacity: scrim }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 190, opacity: titleOut }}>
        <div style={{ overflow: "hidden", paddingBottom: 6 }}>
          <div style={{ fontFamily: serif, fontWeight: 500, fontSize: 92, color: C.cream, letterSpacing: 0.5, translate: `0px ${(1 - rise) * 110}px`, filter: `blur(${blur}px)`, opacity: rise, textShadow: "0 6px 30px rgba(0,0,0,0.6)" }}>
            JJ Furniture Management System
          </div>
        </div>
        <div style={{ width: 760 * line, height: 1, background: C.caramel, boxShadow: `0 0 14px ${C.caramel}`, marginTop: 10 }} />
        <div style={{ marginTop: 22, fontFamily: sans, fontWeight: 700, fontSize: 22, letterSpacing: 6, color: C.latte, textTransform: "uppercase", opacity: ease((t - 3.8) / 0.9) }}>
          JJ Furniture Shop and Enterprises · Valencia City, Bukidnon
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.espresso, opacity: 1 - fadeIn }} />
    </AbsoluteFill>
  );
};
