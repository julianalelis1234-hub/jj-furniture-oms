import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Camera } from "../components/Camera";
import { RoleChip } from "../components/Chrome";
import { WarpedClip } from "../components/WarpedClip";
import { type Anchor, CLIPS, ev, warp } from "../clips";
import { scene } from "../timeline";
import { C, ease, FPS, sans } from "../theme";
import { clipSfx, type Sfx } from "./sfx";

const g = CLIPS.s6;
const o = CLIPS.s6o;
const save = ev(g, "click", "save-payment");
const gateAfter = ev(g, "focus", "gate-after");
const gateMet = ev(g, "chime", "gate-met");
const release = ev(o, "click", "release");

export const OWNER_FROM = 22.6; // local second the owner's screen takes over (2:31.8)
/** scene-local seconds (0 = 2:09.2) */
export const S6_ANCHORS: Anchor[] = [
  [0, 0],
  [save.t, 11.4],
  [gateAfter.t, 12.6],
  [Math.min(g.duration - 0.05, gateAfter.t + 5.2), 23.4],
];
/** owner clip, local to its own Sequence starting at OWNER_FROM */
export const S6_OWNER_ANCHORS: Anchor[] = [
  [0.3, 0],
  [release.t, 5.2],
  [Math.min(o.duration - 0.05, release.t + 4.6), 8.4],
];
export const s6Sfx = (): Sfx[] => [
  ...clipSfx("s6", g, S6_ANCHORS, 0, [0, OWNER_FROM]),
  ...clipSfx("s6", o, S6_OWNER_ANCHORS, OWNER_FROM),
];

/** Motion-graphic summary of the real gate card: 30% required vs verified, filling as the payment is verified. */
export const GateMeter: React.FC<{ at: number }> = ({ at }) => {
  const t = useCurrentFrame() / FPS;
  const show = Math.min(ease((t - (at - 0.8)) / 0.6), 1 - ease((t - (at + 8.2)) / 0.6));
  if (show <= 0) return null;
  const fill = ease((t - at) / 1.4);
  const flipped = fill > 0.97; // flips exactly as the bar completes
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 120, pointerEvents: "none" }}>
      <div style={{ width: 880, padding: "22px 30px", borderRadius: 22, background: "rgba(43,29,23,0.94)", border: `1.5px solid ${flipped ? C.caramel : C.border}`, boxShadow: flipped ? "0 0 40px rgba(196,138,90,0.45)" : "0 20px 50px -10px rgba(0,0,0,0.7)", opacity: show, translate: `0 ${(1 - show) * -20}px`, fontFamily: sans }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontWeight: 700, letterSpacing: 3, fontSize: 20, color: C.caramel, textTransform: "uppercase" }}>30% production gate</span>
          <span style={{ fontWeight: 700, fontSize: 24, color: flipped ? C.cream : C.latte }}>{flipped ? "Verified — Ready for Production" : "Locked — Awaiting 30% Deposit"}</span>
        </div>
        <div style={{ marginTop: 16, height: 18, borderRadius: 99, background: "#4a3329", overflow: "hidden" }}>
          <div style={{ width: `${fill * 100}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${C.mocha}, ${C.caramel})`, boxShadow: `0 0 18px ${C.caramel}` }} />
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 20, color: C.latte }}>
          <span>Only verified furniture payments count</span>
          <span style={{ fontWeight: 700 }}>{Math.round(fill * 100)}% of the 30% down payment</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 2:10 – 2:40 · staff log + verify the 30% → the gate is met → the owner releases to the workshop. */
export const S6Gate: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const A = S6_ANCHORS;
  const metAt = warp(A, gateMet.t);
  const ownerIn = ease((t - OWNER_FROM) / 0.6);
  return (
    <AbsoluteFill>
      <Camera
        shots={[
          { at: 12.8, dur: 0.9, scale: 1.5, box: gateAfter.box },
          { at: 21.8, dur: 0.8, scale: 1.0 },
        ]}
      >
        <WarpedClip name="s6-gate" anchors={A} />
      </Camera>
      <GateMeter at={Math.max(13.2, metAt)} />
      <Sequence from={Math.round(OWNER_FROM * FPS)} name="owner releases">
        <AbsoluteFill style={{ opacity: ownerIn, filter: ownerIn < 1 ? `blur(${(1 - ownerIn) * 6}px)` : undefined }}>
          <Camera shots={[{ at: 4.4, dur: 0.8, scale: 1.1, box: { x: 985, y: 60, width: 911, height: 600 } }]}>
            <WarpedClip name="s6-owner" anchors={S6_OWNER_ANCHORS} />
          </Camera>
          <RoleChip role="Owner · O-01" label="Release to the workshop" delay={0.4} />
        </AbsoluteFill>
      </Sequence>
      {t < OWNER_FROM + 0.3 && <RoleChip role="Staff · S-01" label={scene("s6").label!} delay={1.0} />}
    </AbsoluteFill>
  );
};
