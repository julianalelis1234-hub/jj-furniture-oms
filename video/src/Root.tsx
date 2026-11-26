import React from "react";
import { Composition, Folder } from "remotion";
import { AD_SECONDS, AdVideo } from "./ad/AdVideo";
import { D60_SECONDS, Demo60 } from "./d60/Demo60";
import { D70_SECONDS, Demo70 } from "./d60/Demo70";
import { DemoRoles, ROLES_SECONDS } from "./d60/DemoRoles";
import { DemoRoles80, ROLES80_SECONDS } from "./d60/DemoRoles80";
import { P90_SECONDS, Pitch90 } from "./p90/Pitch90";
import { PitchVideo } from "./PitchVideo";
import { S1Home } from "./scenes/S1Home";
import { S2Roles } from "./scenes/S2Roles";
import { S3Customer } from "./scenes/S3Customer";
import { S4Staff } from "./scenes/S4Staff";
import { S5Accept } from "./scenes/S5Accept";
import { S6Gate } from "./scenes/S6Gate";
import { S7Workshop } from "./scenes/S7Workshop";
import { S8Delivery } from "./scenes/S8Delivery";
import { S9Closing } from "./scenes/S9Closing";
import { FPS, H, TOTAL_FRAMES, W } from "./theme";
import { scene } from "./timeline";

const len = (id: string) => Math.round((scene(id).end - scene(id).start) * FPS);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="PitchVideo" component={PitchVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} />
    <Composition id="Pitch90" component={Pitch90} durationInFrames={P90_SECONDS * FPS} fps={FPS} width={W} height={H} />
    <Composition id="Ad60" component={AdVideo} durationInFrames={AD_SECONDS * FPS} fps={FPS} width={W} height={H} />
    <Composition id="Demo60" component={Demo60} durationInFrames={D60_SECONDS * FPS} fps={FPS} width={W} height={H} />
    <Composition id="Demo70" component={Demo70} durationInFrames={D70_SECONDS * FPS} fps={FPS} width={W} height={H} />
    <Composition id="DemoRoles" component={DemoRoles} durationInFrames={ROLES_SECONDS * FPS} fps={FPS} width={W} height={H} />
    <Composition id="DemoRoles80" component={DemoRoles80} durationInFrames={ROLES80_SECONDS * FPS} fps={FPS} width={W} height={H} />
    <Folder name="Scenes">
      <Composition id="S1-Home" component={S1Home} durationInFrames={len("s1")} fps={FPS} width={W} height={H} />
      <Composition id="S2-Roles" component={S2Roles} durationInFrames={len("s2")} fps={FPS} width={W} height={H} />
      <Composition id="S3-Customer" component={S3Customer} durationInFrames={len("s3")} fps={FPS} width={W} height={H} />
      <Composition id="S4-Staff" component={S4Staff} durationInFrames={len("s4")} fps={FPS} width={W} height={H} />
      <Composition id="S5-Accept" component={S5Accept} durationInFrames={len("s5")} fps={FPS} width={W} height={H} />
      <Composition id="S6-Gate" component={S6Gate} durationInFrames={len("s6")} fps={FPS} width={W} height={H} />
      <Composition id="S7-Workshop" component={S7Workshop} durationInFrames={len("s7")} fps={FPS} width={W} height={H} />
      <Composition id="S8-Delivery" component={S8Delivery} durationInFrames={len("s8")} fps={FPS} width={W} height={H} />
      <Composition id="S9-Closing" component={S9Closing} durationInFrames={len("s9")} fps={FPS} width={W} height={H} />
    </Folder>
  </>
);
