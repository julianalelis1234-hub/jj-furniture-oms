import React from "react";
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import { Camera } from "../components/Camera";
import { RoleChip } from "../components/Chrome";
import { Phone } from "../components/Phone";
import { WarpedClip } from "../components/WarpedClip";
import { type Anchor, CLIPS, ev, evs } from "../clips";
import { C, ease, FPS, sans, SPRING } from "../theme";
import { clipSfx, type Sfx } from "./sfx";

const p = CLIPS.s7;
const o = CLIPS.s7o;
const firstTap = evs(p, "click")[0];
const sendOwner = ev(p, "click", "send-owner");
const arrived = ev(o, "chime", "inspection-arrived");
const pass = ev(o, "click", "pass");
const ready = ev(o, "chime", "ready-for-delivery");

export const SPLIT_AT = 11.8; // 2:51
/** both clips were recorded together on one clock (scene-local 0 = 2:39.2) */
export const S7_ANCHORS: Anchor[] = [
  [0, 0],
  [firstTap.t, 1.9],
  [sendOwner.t, 10.6],
  [arrived.t + 0.3, 13.0],
  [pass.t, 18.4],
  [ready.t + 0.2, 19.4],
  [Math.min(p.duration, o.duration) - 0.1, 22.8],
];
export const s7Sfx = (): Sfx[] => [...clipSfx("s7", p, S7_ANCHORS, 0, [0, SPLIT_AT]), ...clipSfx("s7", o, S7_ANCHORS, 0, [SPLIT_AT, 99])];

/** 2:40 – 3:02 · craftsman on a phone; split-screen with the owner's desktop updating live. */
export const S7Workshop: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const split = spring({ frame: frame - Math.round(SPLIT_AT * FPS), fps: FPS, config: SPRING, durationInFrames: Math.round(0.7 * FPS) });
  const badge = ease((t - (SPLIT_AT + 0.8)) / 0.6);
  const insp = ev(o, "focus", "inspection").box!;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 50%, #3a281f, ${C.espresso} 70%)` }}>
      {/* owner desktop window (enters from the right) */}
      <div style={{ position: "absolute", left: 640 + (1 - split) * 1400, top: 150, width: 1200, height: 675, borderRadius: 22, overflow: "hidden", border: `1.5px solid ${C.caramel}`, boxShadow: "0 0 50px rgba(196,138,90,0.25), 0 40px 90px -20px rgba(0,0,0,0.8)", opacity: split }}>
        <div style={{ position: "absolute", inset: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `scale(${1200 / 1920})` }}>
          <Camera shots={[{ at: SPLIT_AT + 0.6, dur: 0.9, scale: 1.35, box: insp }]}>
            <WarpedClip name="s7-owner" anchors={S7_ANCHORS} />
          </Camera>
        </div>
      </div>
      {/* live sync callout over the owner window */}
      <div style={{ position: "absolute", left: 1240 - 300 + (1 - split) * 1400, top: 86, width: 600, display: "flex", justifyContent: "center", opacity: badge }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px", borderRadius: 999, background: "rgba(43,29,23,0.92)", border: `1.5px solid ${C.caramel}`, fontFamily: sans, fontWeight: 700, fontSize: 24, color: C.cream }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: C.caramel, boxShadow: `0 0 ${10 + 8 * Math.sin(t * 5)}px ${C.caramel}` }} />
          Owner O-01 · Live Sync Active
        </div>
      </div>
      {/* craftsman phone: centred, then slides left */}
      <div style={{ position: "absolute", top: 70, left: 960 - 225 - split * 560 }}>
        <Phone height={940}>
          <WarpedClip name="s7-craftsman" anchors={S7_ANCHORS} />
        </Phone>
      </div>
      <RoleChip role="Craftsman · C-01" label="Workshop progress, synced live" delay={1.0} />
    </AbsoluteFill>
  );
};
