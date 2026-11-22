import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera } from "../components/Camera";
import { Highlight, RoleChip } from "../components/Chrome";
import { WarpedClip } from "../components/WarpedClip";
import { type Anchor, CLIPS, ev, warp } from "../clips";
import { scene } from "../timeline";
import { clipSfx } from "./sfx";

const m = CLIPS.s3;
const submit = ev(m, "click", "submit");
const done = ev(m, "focus", "done");
const finish = ev(m, "click", "finish");

/** scene-local seconds (0 = 0:30.0; the zoom-through lands at 2.0 = 0:32) */
export const S3_ANCHORS: Anchor[] = [
  [0, 0],
  [ev(m, "focus", "preview").t, 2.6],
  [ev(m, "figure").t, 12.4], // drag-rotate under "turn it, inspect every side"
  [ev(m, "focus", "dims").t, 16.0], // hover by the 165 cm figure
  [finish.t + 0.6, 23.6], // size, wood, finish under "She types her exact size..."
  [submit.t - 0.7, 27.7], // contact details, brisk
  [submit.t, 28.4],
  [done.t, 29.8],
  [Math.min(m.duration - 0.05, done.t + 4.0), 35.0],
];
export const s3Sfx = () => clipSfx("s3", m, S3_ANCHORS);

/** 0:32 – 1:05 · the customer designs a piece in the live 3D configurator and requests a quote. */
export const S3Customer: React.FC = () => {
  const A = S3_ANCHORS;
  const preview = ev(m, "focus", "preview").box!;
  return (
    <AbsoluteFill>
      <Camera
        shots={[
          { at: 2.4, dur: 1.1, scale: 1.22, box: preview },
          { at: 12.6, dur: 1.0, scale: 1.0 },
          { at: 16.0, dur: 0.9, scale: 1.38, cx: 760, cy: 700 },
          { at: 23.8, dur: 0.9, scale: 1.0 },
          { at: warp(A, done.t) + 0.2, dur: 0.8, scale: 1.12, box: done.box },
        ]}
      >
        <WarpedClip name="s3-customer" anchors={A} />
        <Highlight box={done.box!} at={warp(A, done.t) + 0.3} hold={4.5} />
      </Camera>
      <RoleChip role={scene("s3").role!} label={scene("s3").label!} delay={2.2} />
    </AbsoluteFill>
  );
};
