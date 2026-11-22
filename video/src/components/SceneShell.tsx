import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { C, ease, FPS, mix } from "../theme";
import type { TransitionKind } from "../timeline";

type Fx = { opacity: number; tx: number; ty: number; scale: number; blur: number; bright: number; clip?: string };
const NONE: Fx = { opacity: 1, tx: 0, ty: 0, scale: 1, blur: 0, bright: 1 };

/** how the INCOMING scene enters (p: 0 -> 1) */
function enter(kind: TransitionKind, p: number, w: number, h: number): Fx {
  const q = 1 - p;
  switch (kind) {
    case "dissolve": return { ...NONE, opacity: p, tx: 40 * q, blur: 6 * q };
    case "zoomThrough": return { ...NONE, opacity: Math.min(1, p * 1.6), scale: mix(1.06, 1, p), blur: 12 * q, clip: `circle(${mix(6, 80, p)}% at 50% 50%)` };
    case "slidePush":
    case "slideLeft": return { ...NONE, tx: w * q, blur: 8 * q };
    case "crossZoom": return { ...NONE, opacity: p, scale: mix(0.92, 1, p), blur: 6 * q };
    case "rackFocus": return { ...NONE, opacity: p, scale: mix(0.96, 1, p), blur: 10 * q };
    case "panUp": return { ...NONE, ty: h * q, blur: 6 * q };
    case "iris": return { ...NONE, opacity: Math.min(1, p * 1.4), clip: `circle(${mix(0, 80, p)}% at 50% 50%)` };
  }
}
/** how the OUTGOING scene leaves while the next one enters */
function leave(kind: TransitionKind, p: number, w: number, h: number): Fx {
  switch (kind) {
    case "dissolve": return { ...NONE, tx: -40 * p, blur: 6 * p };
    case "zoomThrough": return { ...NONE }; // the bubble scene draws its own zoom-through
    case "slidePush":
    case "slideLeft": return { ...NONE, tx: -w * 0.35 * p, blur: 8 * p, bright: mix(1, 0.6, p) };
    case "crossZoom": return { ...NONE, opacity: 1 - p, scale: mix(1, 1.12, p), blur: 8 * p };
    case "rackFocus": return { ...NONE, blur: 10 * p, bright: mix(1, 0.45, p) };
    case "panUp": return { ...NONE, ty: -h * p, blur: 6 * p };
    case "iris": return { ...NONE, opacity: 1 - p * 0.8, blur: 4 * p };
  }
}

/**
 * Wraps one scene: applies its entrance (over `inDur`) and the exit dictated by
 * the NEXT scene's entrance (over the last `outDur` seconds).
 */
export const SceneShell: React.FC<{ inKind?: TransitionKind; inDur?: number; outKind?: TransitionKind; outDur?: number; children: React.ReactNode }> = ({ inKind, inDur = 0, outKind, outDur = 0, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = frame / FPS;
  const total = durationInFrames / FPS;
  let fx = NONE;
  if (inKind && t < inDur) fx = enter(inKind, ease(t / inDur), width, height);
  if (outKind && t > total - outDur) fx = leave(outKind, ease((t - (total - outDur)) / outDur), width, height);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.espresso,
        opacity: fx.opacity,
        transform: `translate(${fx.tx}px, ${fx.ty}px) scale(${fx.scale})`,
        filter: fx.blur > 0.05 || fx.bright !== 1 ? `blur(${fx.blur}px) brightness(${fx.bright})` : undefined,
        clipPath: fx.clip,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
