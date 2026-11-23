import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera } from "../components/Camera";
import { Highlight, RoleChip } from "../components/Chrome";
import { WarpedClip } from "../components/WarpedClip";
import { type Anchor, CLIPS, ev, warp } from "../clips";
import { scene } from "../timeline";
import { clipSfx, type Sfx } from "./sfx";

const m = CLIPS.s4;
const arrived = ev(m, "arrived");
const row = ev(m, "focus", "newrow");
const rowClick = ev(m, "click", "row");
const dialog = ev(m, "focus", "quote-dialog");
const send = ev(m, "click", "send");
const kpis = ev(m, "focus", "kpis").box!;

/** scene-local seconds (0 = 1:04.2) */
export const S4_ANCHORS: Anchor[] = [
  [0, 0],
  [Math.max(0.5, arrived.t - 0.6), 6.2],
  [arrived.t + 0.8, 7.6],
  [rowClick.t - 1.2, 12.0],
  [rowClick.t, 12.8],
  [dialog.t, 21.6],
  [send.t, 30.0],
  [Math.min(m.duration - 0.05, send.t + 4.0), 33.8],
];
/** the live arrival chime lands when the row actually appears */
export const s4Sfx = (): Sfx[] => [...clipSfx("s4", m, S4_ANCHORS).filter((s) => s.kind === "click" || s.t > scene("s4").start + 20), { t: scene("s4").start + warp(S4_ANCHORS, arrived.t), kind: "chime" }];

/** 1:05 – 1:38 · the request slides into the staff queue live; drawer; official quotation. */
export const S4Staff: React.FC = () => {
  const A = S4_ANCHORS;
  const union = { x: kpis.x, y: kpis.y, width: kpis.width, height: row.box!.y + row.box!.height - kpis.y };
  return (
    <AbsoluteFill>
      <Camera
        shots={[
          { at: 6.6, dur: 0.8, scale: 1.45, box: union },
          { at: 12.0, dur: 0.8, scale: 1.0 },
          { at: warp(A, dialog.t) + 0.2, dur: 0.8, scale: 1.12, box: dialog.box },
          { at: warp(A, send.t) + 0.6, dur: 0.9, scale: 1.0 },
        ]}
      >
        <WarpedClip name="s4-staff" anchors={A} />
        <Highlight box={row.box!} at={warp(A, arrived.t) + 0.1} hold={4.6} pad={4} radius={12} />
      </Camera>
      <RoleChip role={scene("s4").role!} label={scene("s4").label!} delay={1.0} />
    </AbsoluteFill>
  );
};
