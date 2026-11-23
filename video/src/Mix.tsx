import { Audio } from "@remotion/media";
import React from "react";
import { Sequence, staticFile } from "remotion";
import { BUBBLE_IN } from "./scenes/S2Roles";
import { s3Sfx } from "./scenes/S3Customer";
import { s4Sfx } from "./scenes/S4Staff";
import { s5Sfx } from "./scenes/S5Accept";
import { s6Sfx } from "./scenes/S6Gate";
import { s7Sfx } from "./scenes/S7Workshop";
import { CUSTOMER_FROM, s8Sfx, TRACKER_AT } from "./scenes/S8Delivery";
import type { Sfx } from "./scenes/sfx";
import { db, FPS, mix, TOTAL_SECONDS } from "./theme";
import { scene, SCENES } from "./timeline";
import { SCHEDULE, voActivity } from "./vo";

/** Target levels from the brief (dB relative to each file's -1 dBFS peak). */
const LEVEL = { musicUnderVo: -22, musicTransition: -14, musicRest: -18, whoosh: -12, pop: -10, click: -11, chime: -9, swell: -12 };

export const SFX: Sfx[] = (() => {
  const list: Sfx[] = [
    { t: 2.2, kind: "swell" }, // title reveal
    ...SCENES.filter((s) => s.in).map((s) => ({ t: s.start, kind: "whoosh" as const })),
    ...BUBBLE_IN.map((b) => ({ t: scene("s2").start + b, kind: "pop" as const })),
    ...s3Sfx(),
    ...s4Sfx(),
    ...s5Sfx(),
    ...s6Sfx(),
    ...s7Sfx(),
    ...s8Sfx(),
    { t: scene("s8").start + CUSTOMER_FROM, kind: "whoosh" },
    { t: scene("s8").start + TRACKER_AT + 6 * 0.32, kind: "chime" },
    { t: scene("s9").start + 6.0, kind: "swell" },
  ];
  // de-duplicate sounds of the same kind closer than 0.12 s
  return list.sort((a, b) => a.t - b.t).filter((s, i, a) => !a.slice(0, i).some((p) => p.kind === s.kind && Math.abs(p.t - s.t) < 0.12));
})();

/** 0..1 bump around every scene transition */
function transitionBump(t: number) {
  let b = 0;
  for (const s of SCENES) {
    if (!s.in) continue;
    const a = s.start - 0.4;
    const e = s.start + s.in.dur + 0.4;
    if (t > a && t < e) b = Math.max(b, Math.sin(Math.PI * ((t - a) / (e - a))));
  }
  return b;
}

/** music level in dB at global second t */
export function musicDb(t: number): number {
  const vo = voActivity(t);
  let level = mix(mix(LEVEL.musicRest, LEVEL.musicTransition, transitionBump(t)), LEVEL.musicUnderVo, vo);
  if (t > 203) level = mix(level, -12, Math.min(1, (t - 203) / 3)); // closing swell
  if (t > 208.5) level = mix(level, -60, Math.min(1, (t - 208.5) / 1.5)); // fade out
  if (t < 1.5) level = mix(-40, level, t / 1.5);
  return level;
}

export const Mix: React.FC = () => (
  <>
    <Audio src={staticFile("audio/music-bed.mp3")} volume={(f) => db(musicDb(f / FPS))} trimAfter={TOTAL_SECONDS * FPS} name="Music bed (ducked)" />
    {SCHEDULE.filter((l) => l.hasAudio).map((l) => (
      <Sequence key={l.id} from={Math.round(l.start * FPS)} durationInFrames={Math.ceil((l.end - l.start + 0.2) * FPS)} name={`VO ${l.id}`}>
        <Audio src={staticFile(`vo/${l.id}.mp3`)} />
      </Sequence>
    ))}
    {SFX.map((s, i) => (
      <Sequence key={i} from={Math.max(0, Math.round(s.t * FPS) - (s.kind === "whoosh" ? 6 : 0))} durationInFrames={Math.round(3 * FPS)} name={`SFX ${s.kind}`}>
        <Audio src={staticFile(`audio/${s.kind}.wav`)} volume={db(LEVEL[s.kind])} />
      </Sequence>
    ))}
  </>
);
