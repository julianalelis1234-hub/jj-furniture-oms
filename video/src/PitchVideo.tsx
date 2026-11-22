import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Captions } from "./components/Captions";
import { SceneShell } from "./components/SceneShell";
import { Mix } from "./Mix";
import { S1Home } from "./scenes/S1Home";
import { S2Roles } from "./scenes/S2Roles";
import { S3Customer } from "./scenes/S3Customer";
import { S4Staff } from "./scenes/S4Staff";
import { S5Accept } from "./scenes/S5Accept";
import { S6Gate } from "./scenes/S6Gate";
import { S7Workshop } from "./scenes/S7Workshop";
import { S8Delivery } from "./scenes/S8Delivery";
import { S9Closing } from "./scenes/S9Closing";
import { C, FPS } from "./theme";
import { SCENES } from "./timeline";

const COMPONENTS: Record<string, React.FC> = { s1: S1Home, s2: S2Roles, s3: S3Customer, s4: S4Staff, s5: S5Accept, s6: S6Gate, s7: S7Workshop, s8: S8Delivery, s9: S9Closing };

/** JJ Furniture Management System — 3:30 pitch demo, 1920x1080 @ 60 fps. */
export const PitchVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.espresso }}>
    {SCENES.map((s, i) => {
      const next = SCENES[i + 1];
      const Comp = COMPONENTS[s.id];
      return (
        <Sequence key={s.id} name={s.id} from={Math.round(s.start * FPS)} durationInFrames={Math.round((s.end - s.start) * FPS)} premountFor={FPS * 2}>
          <SceneShell inKind={s.in?.kind} inDur={s.in?.dur} outKind={next?.in?.kind} outDur={next ? s.end - next.start : 0}>
            <Comp />
          </SceneShell>
        </Sequence>
      );
    })}
    <Captions />
    <Mix />
  </AbsoluteFill>
);
