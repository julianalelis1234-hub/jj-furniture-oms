import { Video } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import type { Anchor } from "../clips";
import { FPS } from "../theme";

/**
 * Plays a captured clip through a piecewise-linear time warp, so waits can be
 * compressed while key actions stay close to real speed. Each anchor segment is
 * its own <Video> with a constant playbackRate. Times are scene-local seconds.
 */
export const WarpedClip: React.FC<{ name: string; anchors: Anchor[]; style?: React.CSSProperties }> = ({ name, anchors, style }) => {
  const src = staticFile(`clips/${name}.mp4`);
  return (
    <AbsoluteFill style={style}>
      {anchors.slice(1).map(([c1, s1], i) => {
        const [c0, s0] = anchors[i];
        const from = Math.round(s0 * FPS);
        const dur = Math.max(1, Math.round(s1 * FPS) - from);
        const rate = Math.min(10, Math.max(0.25, (c1 - c0) / (s1 - s0)));
        return (
          <Sequence key={i} from={from} durationInFrames={dur} name={`${name} ×${rate.toFixed(2)}`} premountFor={FPS}>
            <Video src={src} trimBefore={Math.round(c0 * FPS)} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
