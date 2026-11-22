import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { Box } from "../clips";
import { ease, FPS, mix } from "../theme";

/** A camera move: at scene second `at`, glide over `dur` seconds to `scale` centred on `box` (or the frame). */
export type Shot = { at: number; dur?: number; scale: number; box?: Box | null; cx?: number; cy?: number };

type State = { s: number; cx: number; cy: number };

/**
 * Smooth zooms into real UI elements of a captured clip. `size` is the clip's
 * pixel size; boxes are in clip pixels. A slow, continuous micro-drift keeps the
 * frame alive between moves.
 */
export const Camera: React.FC<{ shots: Shot[]; size?: { w: number; h: number }; drift?: number; children: React.ReactNode }> = ({ shots, size = { w: 1920, h: 1080 }, drift = 0.012, children }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const target = (sh: Shot): State => ({
    s: sh.scale,
    cx: sh.cx ?? (sh.box ? sh.box.x + sh.box.width / 2 : size.w / 2),
    cy: sh.cy ?? (sh.box ? sh.box.y + sh.box.height / 2 : size.h / 2),
  });
  let cur: State = { s: 1, cx: size.w / 2, cy: size.h / 2 };
  for (const sh of [...shots].sort((a, b) => a.at - b.at)) {
    if (sh.at > t) break;
    const p = ease((t - sh.at) / (sh.dur ?? 0.9));
    const to = target(sh);
    cur = { s: mix(cur.s, to.s, p), cx: mix(cur.cx, to.cx, p), cy: mix(cur.cy, to.cy, p) };
  }
  const s = cur.s * (1 + drift * Math.sin(t * 0.35));
  const tx = Math.min(0, Math.max(size.w - size.w * s, size.w / 2 - cur.cx * s));
  const ty = Math.min(0, Math.max(size.h - size.h * s, size.h / 2 - cur.cy * s));
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ width: size.w, height: size.h, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
