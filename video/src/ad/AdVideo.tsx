import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { SFX } from "../Mix";
import { PitchVisuals } from "../PitchVideo";
import { C, db, ease, FPS, mix, SPRING, wordmark } from "../theme";
import { makeSchedule, voActivity } from "../vo";
import { AD_SCRIPT } from "./adScript";

export const AD_SECONDS = 60;
const BEAT = 60 / 125; // the ad music runs at 125 BPM: every cut lands on a beat
const OVERLAP = 0.2; // short cross-dissolve into each cut

/**
 * The ad is an edit of highlights from the 3:30 pitch timeline: each piece shows
 * `beats` beats of the pitch starting at pitch-second `src`.
 */
const PIECES: { src: number; beats: number; label: string }[] = [
  { src: 1.5, beats: 10, label: "title" },
  { src: 14.9, beats: 6, label: "roles pop in" },
  { src: 28.9, beats: 5, label: "orbit → zoom-through" },
  { src: 33.0, beats: 8, label: "3D turntable" },
  { src: 47.4, beats: 8, label: "size, wood, finish" },
  { src: 57.8, beats: 6, label: "request sent" },
  { src: 70.0, beats: 8, label: "live in the staff queue" },
  { src: 92.6, beats: 6, label: "official quotation" },
  { src: 108.6, beats: 6, label: "customer accepts" },
  { src: 122.2, beats: 8, label: "password → confirmed" },
  { src: 141.8, beats: 8, label: "30% gate verified" },
  { src: 155.6, beats: 6, label: "owner releases" },
  { src: 168.6, beats: 5, label: "craftsman phone" },
  { src: 174.8, beats: 8, label: "owner passes inspection, live" },
  { src: 184.0, beats: 8, label: "driver delivers" },
  { src: 191.0, beats: 6, label: "7 stages complete" },
  { src: 198.4, beats: 13, label: "brand card" },
];
export const CUTS = (() => {
  let at = 0;
  return PIECES.map((p) => {
    const c = { ...p, at, len: p.beats * BEAT };
    at += c.len;
    return c;
  });
})(); // 125 beats = exactly 60 s

export const AD_SCHEDULE = makeSchedule(AD_SCRIPT, "ad-");

/** Ad SFX: a whoosh on every cut, plus the pitch's own clicks / chimes / pops inside each piece. */
const AD_SFX = (() => {
  const out: { t: number; kind: string; gain: number }[] = [];
  for (const c of CUTS) {
    if (c.at > 0) out.push({ t: c.at - 0.08, kind: "whoosh", gain: -15 });
    for (const s of SFX) {
      if (s.kind === "whoosh" || s.kind === "swell") continue;
      if (s.t >= c.src && s.t < c.src + c.len) out.push({ t: c.at + (s.t - c.src), kind: s.kind, gain: s.kind === "click" ? -13 : -11 });
    }
  }
  return out;
})();

/** music level (dB vs. its -1 dBFS peak): louder than the pitch, ducked under the voice */
const musicDb = (t: number) => {
  let l = mix(-5, -12, voActivity(t, AD_SCHEDULE));
  if (t > 59.2) l = mix(l, -50, Math.min(1, (t - 59.2) / 0.8));
  return l;
};

const Piece: React.FC<{ src: number; len: number }> = ({ src, len }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const fadeIn = ease(t / OVERLAP);
  const punch = 1 + 0.06 * (1 - ease((t - OVERLAP * 0.5) / 0.45)); // beat "punch" into each cut
  const blur = 5 * (1 - ease(t / 0.3));
  return (
    <AbsoluteFill style={{ opacity: fadeIn, scale: String(punch), filter: blur > 0.05 ? `blur(${blur}px)` : undefined }}>
      <Sequence from={-Math.round((src - OVERLAP) * FPS)} durationInFrames={Math.round((src + len + OVERLAP) * FPS)}>
        <PitchVisuals />
      </Sequence>
    </AbsoluteFill>
  );
};

/** Bold, punchy captions (the narrated words). */
const AdCaptions: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const line = AD_SCHEDULE.find((s) => t >= s.start - 0.1 && t <= s.end + 0.35);
  if (!line) return null;
  const pop = spring({ frame: frame - Math.round((line.start - 0.1) * FPS), fps: FPS, config: SPRING });
  const out = 1 - ease((t - (line.end + 0.05)) / 0.3);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 64, pointerEvents: "none" }}>
      <div style={{ maxWidth: 1500, padding: "16px 34px 18px", borderRadius: 20, background: "rgba(43,29,23,0.9)", border: `2px solid ${C.caramel}`, boxShadow: "0 0 36px rgba(196,138,90,0.35), 0 20px 50px -12px rgba(0,0,0,0.7)", fontFamily: wordmark, fontWeight: 800, fontSize: 42, lineHeight: 1.25, color: C.cream, textAlign: "center", opacity: Math.min(pop * 1.4, out), scale: String(0.9 + 0.1 * pop) }}>
        {line.text}
      </div>
    </AbsoluteFill>
  );
};

const Progress: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(t / AD_SECONDS) * 100}%`, background: `linear-gradient(90deg, ${C.mocha}, ${C.caramel})`, boxShadow: `0 0 12px ${C.caramel}` }} />;
};

/** JJ Furniture — 60-second ad, 1920x1080 @ 60 fps. */
export const AdVideo: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill style={{ backgroundColor: C.espresso }}>
      {CUTS.map((c, i) => (
        <Sequence key={i} name={c.label} from={Math.max(0, Math.round((c.at - OVERLAP) * FPS))} durationInFrames={Math.round((c.len + (i ? OVERLAP : 0)) * FPS)} premountFor={FPS}>
          <Piece src={i ? c.src : c.src + OVERLAP} len={c.len} />
        </Sequence>
      ))}
      <AdCaptions />
      <Progress />
      {/* closing fade */}
      <AbsoluteFill style={{ backgroundColor: C.espresso, opacity: ease((t - 59.1) / 0.9), pointerEvents: "none" }} />

      <Audio src={staticFile("audio/ad-music.mp3")} volume={(f) => db(musicDb(f / FPS))} name="Energetic music (ducked)" />
      {AD_SCHEDULE.filter((l) => l.hasAudio).map((l) => (
        <Sequence key={l.id} from={Math.round(l.start * FPS)} durationInFrames={Math.ceil((l.end - l.start + 0.2) * FPS)} name={`VO ${l.id}`}>
          <Audio src={staticFile(`vo/${l.id}.mp3`)} />
        </Sequence>
      ))}
      {AD_SFX.map((s, i) => (
        <Sequence key={i} from={Math.max(0, Math.round(s.t * FPS))} durationInFrames={Math.round(2.5 * FPS)} name={`SFX ${s.kind}`}>
          <Audio src={staticFile(`audio/${s.kind}.wav`)} volume={db(s.gain)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
