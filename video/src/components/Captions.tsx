import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, ease, FPS, sans } from "../theme";
import { SCHEDULE } from "../vo";

/** Lower-third captions, exactly the narrated words, so the pitch also works muted. */
export const Captions: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const line = SCHEDULE.find((s) => t >= s.start - 0.15 && t <= s.end + 0.45);
  if (!line) return null;
  const pin = ease((t - (line.start - 0.15)) / 0.35);
  const pout = 1 - ease((t - (line.end + 0.1)) / 0.35);
  const p = Math.min(pin, pout);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 54, pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 1380,
          padding: "16px 30px 18px",
          borderRadius: 18,
          background: "rgba(43, 29, 23, 0.86)",
          border: `1px solid ${C.border}`,
          boxShadow: "0 18px 48px -12px rgba(0,0,0,0.6)",
          borderTop: `1px solid rgba(196,138,90,0.55)`,
          color: C.latte,
          fontFamily: sans,
          fontWeight: 600,
          fontSize: 33,
          lineHeight: 1.35,
          textAlign: "center",
          opacity: p,
          translate: `0px ${(1 - p) * 14}px`,
        }}
      >
        {line.text}
      </div>
    </AbsoluteFill>
  );
};
