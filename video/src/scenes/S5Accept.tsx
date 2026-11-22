import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Camera } from "../components/Camera";
import { Highlight, RoleChip } from "../components/Chrome";
import { WarpedClip } from "../components/WarpedClip";
import { type Anchor, CLIPS, ev, warp } from "../clips";
import { scene } from "../timeline";
import { clamp01, FPS } from "../theme";
import { clipSfx } from "./sfx";

const m = CLIPS.s5;
const review = ev(m, "click", "review-link");
const accept = ev(m, "click", "accept");
const accepted = ev(m, "focus", "accepted");
const flip = ev(m, "flip");
const setupLink = ev(m, "click", "setup-link");
const form = ev(m, "focus", "password-form");
const save = ev(m, "click", "save");
const orders = ev(m, "focus", "orders");

/** scene-local seconds (0 = 1:37.2) */
export const S5_ANCHORS: Anchor[] = [
  [0, 0],
  [review.t, 3.4],
  [accept.t, 13.4],
  [flip.t - 0.1, 16.0],
  [setupLink.t, 19.6],
  [save.t, 27.8],
  [Math.min(m.duration - 0.05, orders.t + 4.0), 32.8],
];
export const s5Sfx = () => clipSfx("s5", m, S5_ANCHORS);

/** 1:38 – 2:10 · quotation email → acceptance → create-password email → logged in, Confirmed. */
export const S5Accept: React.FC = () => {
  const A = S5_ANCHORS;
  const t = useCurrentFrame() / FPS;
  // vertical card slide on the page change from the acceptance screen to the second email
  const f = warp(A, flip.t);
  const p = clamp01((t - (f - 0.3)) / 0.6);
  const bump = Math.sin(Math.PI * p);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `perspective(1600px) rotateX(${bump * 7}deg) translateY(${-bump * 46}px)`, filter: bump > 0.01 ? `blur(${bump * 10}px)` : undefined }}>
        <Camera
          shots={[
            { at: 0.3, dur: 0.9, scale: 1.15, box: ev(m, "focus", "quote-email").box },
            { at: 3.6, dur: 0.8, scale: 1.0 },
            { at: warp(A, accepted.t) + 0.1, dur: 0.8, scale: 1.15, box: accepted.box },
            { at: f + 0.3, dur: 0.6, scale: 1.15, box: ev(m, "focus", "setup-email").box },
            { at: warp(A, setupLink.t) + 0.3, dur: 0.8, scale: 1.25, box: form.box },
            { at: warp(A, save.t) + 0.5, dur: 0.8, scale: 1.08, box: orders.box },
          ]}
        >
          <WarpedClip name="s5-accept" anchors={A} />
          <Highlight box={accepted.box!} at={warp(A, accepted.t) + 0.2} hold={2.0} />
          <Highlight box={orders.box!} at={warp(A, orders.t) + 0.2} hold={4} />
        </Camera>
      </AbsoluteFill>
      <RoleChip role={scene("s5").role!} label={scene("s5").label!} delay={1.0} />
    </AbsoluteFill>
  );
};
