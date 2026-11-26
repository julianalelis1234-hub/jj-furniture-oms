// JJ Enterprises — 1:10 pitch demo. The first 27 s are the Demo60 opening (hook, AI design + 3D,
// AR, the order landing live on the owner's screen). Then the OWNER RELAY: the owner's laptop is the
// main screen for every step, the customer's phone stays docked on the right and updates live after
// each one, and whoever triggers a step (customer, craftsman, rider) pops up as a phone in the centre.
// All screens are the real app (capture/capture-demo70.mjs), recorded together so every sync is real;
// footage plays at about real speed (<= 1.5x) with soft cuts over the waits.
import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { C, db, ease, FPS, mix, sans } from "../theme";
import type { Anchor } from "./clips60";
import { Ar, Design, EndCard, Hook, SFX as SFX60, type Sfx, SyncOrder } from "./Demo60";
import { Backdrop, Beam, Cam, Caption, CutClip, PhoneShell, Ring, type Seg, type Tag, WarpVideo, Window } from "./kit";

export const D70_SECONDS = 70;
const BEAT = 60 / 125;
const b = (n: number) => +(n * BEAT).toFixed(4);
const RELAY_START = b(56); // 26.88 s
const END_START = b(134); // 64.32 s: the music's ending hit

// --------------------------------------------------------------------------- layout
const OW = { x: 60, y: 64, w: 1380, h: 776 }; // owner laptop
const DOCK = { x: 1500, y: 92, h: 860 }; // customer phone
const CENTER = { x: OW.x + OW.w / 2, y: 60, h: 820 };
const NEXT = { x: 985, y: 197, width: 911, height: 164 };
const phoneW = (h: number) => ((h - 30) * 390) / 844 + 30;

// ----------------------------------------------------------------------------- beats
type Beat = {
  id: string; start: number; len: number;
  tag: Tag; text: string;
  owner: { clip: string; segs: Seg[] };
  dock?: { clip: string; parts: Anchor[][]; from?: number };
  /** the phone that triggers this step pops up in the centre */
  pop?: { clip: string; parts: Anchor[][]; at: number; out: number; label: string; fromDock?: boolean };
  beams: { x1: number; y1: number; x2: number; y2: number; at: number }[];
  rings?: { box: { x: number; y: number; width: number; height: number }; at: number; hold?: number }[];
  dockPulse?: number[];
  sfx: Sfx[];
};
const sh = (scale: number, box?: { x: number; y: number; width: number; height: number }, cx?: number, cy?: number, at = 0, dur = 0) => ({ at, dur, scale, box, cx, cy });

// the owner window's on-screen point for a clip point (shots are simple: used for beam anchors only)
const DOCK_PT = { x: DOCK.x + 30, y: DOCK.y + 300 };

const BEATS: Beat[] = [
  {
    id: "A quote", start: 0, len: b(10), tag: "OWNER", text: "Confirms the order and sends the quotation.",
    owner: { clip: "d70-quote", segs: [
      { c0: 1.3, c1: 2.7, s0: 0, s1: 1.1, shots: [sh(1.45, NEXT)] },
      { c0: 4.5, c1: 5.75, s0: 1.1, s1: 2.1, shots: [sh(1.55, { x: 464, y: 760, width: 900, height: 260 })] },
      { c0: 7.7, c1: 9.6, s0: 2.1, s1: b(10), shots: [sh(1.4, undefined, 1250, 900), sh(1.3, undefined, 960, 180, 1.2, 0.9)] },
    ] },
    dock: { clip: "d70-c-quote", parts: [[[1.0, 2.7], [5.6, b(10)]]], from: 2.7 },
    beams: [{ x1: 900, y1: 600, x2: DOCK_PT.x, y2: DOCK_PT.y, at: 2.25 }],
    sfx: [{ t: 0.85, kind: "click", gain: -14 }, { t: 1.2, kind: "click", gain: -15 }, { t: 2.2, kind: "click", gain: -14 }, { t: 2.75, kind: "chime", gain: -10 }],
  },
  {
    id: "B accept", start: b(10), len: b(10), tag: "LIVE SYNC", text: "The customer accepts on the phone. The owner sees it live.",
    owner: { clip: "d70-accepted", segs: [
      { c0: 9.0, c1: 11.5, s0: 0, s1: 2.9, shots: [sh(1.45, NEXT)] },
      { c0: 14.3, c1: 15.9, s0: 2.9, s1: b(10), shots: [sh(1.45, NEXT)] },
    ] },
    pop: { clip: "d70-accept", parts: [[[1.9, 0.3], [4.9, 2.3]], [[8.6, 2.3], [12.6, 3.3]]], at: 0.05, out: 3.25, label: "CUSTOMER", fromDock: true },
    dock: { clip: "d70-accept", parts: [[[12.6, 3.3], [14.0, b(10)]]], from: 0 },
    beams: [{ x1: CENTER.x, y1: 520, x2: 1100, y2: 330, at: 2.95 }],
    rings: [{ box: NEXT, at: 3.4, hold: 1.1 }],
    sfx: [{ t: 0.3, kind: "pop", gain: -13 }, { t: 0.55, kind: "click", gain: -15 }, { t: 1.95, kind: "click", gain: -15 }, { t: 2.85, kind: "click", gain: -14 }, { t: 3.4, kind: "chime", gain: -9 }],
  },
  {
    id: "C release", start: b(20), len: b(10), tag: "OWNER", text: "Approves the plan and assigns the craftsman.",
    owner: { clip: "d70-release", segs: [
      { c0: 1.6, c1: 3.5, s0: 0, s1: 1.4, shots: [sh(1.45, NEXT)] },
      { c0: 7.3, c1: 8.6, s0: 1.4, s1: 2.4, shots: [sh(1.5, undefined, 1000, 640)] },
      { c0: 10.3, c1: 11.9, s0: 2.4, s1: 3.6, shots: [sh(1.45, undefined, 1050, 700)] },
      { c0: 11.9, c1: 13.0, s0: 3.6, s1: b(10), shots: [sh(1.3, undefined, 960, 200)] },
    ] },
    dock: { clip: "d70-c-prod", parts: [[[9.4, 0], [13.9, 3.0]], [[14.3, 3.0], [16.4, b(10)]]] },
    beams: [{ x1: 1000, y1: 560, x2: DOCK_PT.x, y2: DOCK_PT.y, at: 3.0 }],
    dockPulse: [3.55],
    sfx: [{ t: 0.5, kind: "click", gain: -14 }, { t: 1.1, kind: "chime", gain: -14 }, { t: 1.75, kind: "click", gain: -15 }, { t: 2.75, kind: "click", gain: -14 }, { t: 3.55, kind: "chime", gain: -9 }],
  },
  {
    id: "D craftsman", start: b(30), len: b(10), tag: "CRAFTSMAN", text: "The craftsman marks it done. Owner and customer see it.",
    owner: { clip: "d70-insp", segs: [
      { c0: 2.0, c1: 4.9, s0: 0, s1: 2.6, shots: [sh(1.3, { x: 469, y: 646, width: 1238, height: 155 })] },
      { c0: 5.6, c1: 7.6, s0: 2.6, s1: b(10), shots: [sh(1.3, { x: 469, y: 646, width: 1238, height: 155 })] },
    ] },
    pop: { clip: "d70-craft", parts: [[[1.3, 0.2], [4.9, 2.6]]], at: 0.05, out: 2.65, label: "CRAFTSMAN" },
    dock: { clip: "d70-c-insp", parts: [[[2.0, 0], [4.9, 2.6]], [[6.3, 2.6], [8.5, b(10)]]] },
    beams: [{ x1: CENTER.x, y1: 560, x2: 900, y2: 700, at: 2.6 }, { x1: CENTER.x + 120, y1: 420, x2: DOCK_PT.x, y2: DOCK_PT.y, at: 2.65 }],
    rings: [{ box: { x: 469, y: 646, width: 1238, height: 155 }, at: 3.0, hold: 1.4 }],
    dockPulse: [3.1],
    sfx: [{ t: 0.1, kind: "pop", gain: -13 }, { t: 0.7, kind: "click", gain: -15 }, { t: 2.1, kind: "click", gain: -14 }, { t: 3.0, kind: "chime", gain: -9 }],
  },
  {
    id: "E pass + rider", start: b(40), len: b(12), tag: "OWNER", text: "Passes the inspection and assigns rider Jesse.",
    owner: { clip: "d70-pass", segs: [
      { c0: 0.9, c1: 3.4, s0: 0, s1: 1.9, shots: [sh(1.35, { x: 469, y: 646, width: 1238, height: 155 })] },
      { c0: 9.9, c1: 11.2, s0: 1.9, s1: 2.9, shots: [sh(1.5, undefined, 1000, 520)] },
      { c0: 12.6, c1: 14.3, s0: 2.9, s1: 4.2, shots: [sh(1.45, undefined, 1050, 700)] },
      { c0: 14.3, c1: 15.8, s0: 4.2, s1: b(12), shots: [sh(1.3, undefined, 960, 200)] },
    ] },
    dock: { clip: "d70-c-ready", parts: [[[1.4, 0], [4.4, 1.9]], [[4.4, 1.9], [5.4, 2.9]], [[14.9, 2.9], [17.4, b(12)]]] },
    beams: [{ x1: 900, y1: 560, x2: DOCK_PT.x, y2: DOCK_PT.y, at: 1.1 }, { x1: 1000, y1: 560, x2: DOCK_PT.x, y2: DOCK_PT.y + 300, at: 3.85 }],
    dockPulse: [1.55, 4.4],
    sfx: [{ t: 0.45, kind: "click", gain: -14 }, { t: 1.4, kind: "click", gain: -15 }, { t: 1.55, kind: "chime", gain: -10 }, { t: 2.35, kind: "click", gain: -15 }, { t: 3.3, kind: "click", gain: -14 }, { t: 4.4, kind: "chime", gain: -10 }],
  },
  {
    id: "F rider", start: b(52), len: b(12), tag: "RIDER", text: "The rider delivers. Everyone sees it live.",
    owner: { clip: "d70-o-deliv", segs: [
      { c0: 0.6, c1: 3.1, s0: 0, s1: 1.9, shots: [sh(1.35, undefined, 1000, 330)] },
      { c0: 4.9, c1: 7.9, s0: 1.9, s1: 3.9, shots: [sh(1.35, undefined, 1000, 330)] },
      { c0: 10.5, c1: 12.4, s0: 3.9, s1: b(12), shots: [sh(1.35, undefined, 1000, 330)] },
    ] },
    pop: { clip: "d70-rider", parts: [[[0.6, 0.2], [3.1, 1.9]], [[4.9, 1.9], [7.9, 3.9]]], at: 0.05, out: 3.95, label: "RIDER" },
    dock: { clip: "d70-c-deliv", parts: [[[0.6, 0], [3.1, 1.9]], [[4.9, 1.9], [7.9, 3.9]], [[10.0, 3.9], [11.9, b(12)]]] },
    beams: [{ x1: CENTER.x - 60, y1: 560, x2: 1150, y2: 380, at: 3.85 }, { x1: CENTER.x + 120, y1: 420, x2: DOCK_PT.x, y2: DOCK_PT.y, at: 3.9 }],
    rings: [{ box: { x: 1215, y: 352, width: 125, height: 186 }, at: 4.45, hold: 1.2 }],
    dockPulse: [2.9, 4.3],
    sfx: [{ t: 0.1, kind: "pop", gain: -13 }, { t: 0.55, kind: "click", gain: -15 }, { t: 1.4, kind: "click", gain: -14 }, { t: 2.1, kind: "click", gain: -15 }, { t: 3.1, kind: "click", gain: -14 }, { t: 4.3, kind: "chime", gain: -8 }],
  },
  {
    id: "G paid", start: b(64), len: b(14), tag: "LIVE SYNC", text: "After delivery, every payment still syncs.",
    owner: { clip: "d70-pay", segs: [
      { c0: 0.6, c1: 5.9, s0: 0, s1: 4.0, shots: [sh(1.3, { x: 985, y: 771, width: 911, height: 310 }), sh(1.45, undefined, 1050, 640, 1.0, 0.9)] },
      { c0: 5.9, c1: 8.6, s0: 4.0, s1: b(14), shots: [sh(1.3, undefined, 960, 300)] },
    ] },
    dock: { clip: "d70-c-paid", parts: [[[0.6, 0], [5.9, 4.0]], [[5.9, 4.0], [8.6, b(14)]]] },
    beams: [{ x1: 1050, y1: 640, x2: DOCK_PT.x, y2: DOCK_PT.y + 120, at: 3.7 }],
    dockPulse: [4.1],
    sfx: [{ t: 0.85, kind: "click", gain: -14 }, { t: 2.0, kind: "click", gain: -15 }, { t: 3.4, kind: "click", gain: -14 }, { t: 4.1, kind: "chime", gain: -9 }],
  },
];

// ----------------------------------------------------------------------------- pieces
const Parts: React.FC<{ clipName: string; parts: Anchor[][] }> = ({ clipName, parts }) => (
  <>
    {parts.map((a, i) => (
      <WarpVideo key={i} src={`clips/${clipName}.mp4`} anchors={a} />
    ))}
  </>
);

/** the owner's laptop for one beat (fades in over the previous beat) */
const OwnerBeat: React.FC<{ beat: Beat }> = ({ beat }) => {
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill style={{ opacity: ease((t + 0.0) / 0.35) }}>
      <CutClip src={`clips/${beat.owner.clip}.mp4`} segs={beat.owner.segs} viewW={OW.w} viewH={OW.h} />
      {beat.rings?.map((r, i) => (
        <Cam key={i} viewW={OW.w} viewH={OW.h} shots={beat.owner.segs[beat.owner.segs.length - 1].shots.map((x) => ({ ...x, at: 0, dur: 0 }))} drift={0}>
          <Ring box={r.box} at={r.at} hold={r.hold} />
        </Cam>
      ))}
    </AbsoluteFill>
  );
};

/** the customer's phone, docked on the right; glows when it updates */
const Dock: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS; // relay time
  const enter = spring({ frame: frame - Math.round(2.6 * FPS), fps: FPS, config: { damping: 20, stiffness: 110, mass: 0.9 } });
  // during the customer's own trigger (beat B) the docked phone travels to the centre and back
  const B = BEATS[1];
  const go = ease((t - B.start - 0.0) / 0.45) - ease((t - B.start - B.pop!.out) / 0.5);
  const cw = phoneW(CENTER.h);
  const x = mix(DOCK.x, CENTER.x - cw / 2, go), y = mix(DOCK.y, CENTER.y, go), h = mix(DOCK.h, CENTER.h, go);
  const pulse = BEATS.flatMap((bt) => (bt.dockPulse ?? []).map((p) => bt.start + p)).reduce((acc, p) => Math.max(acc, t >= p && t < p + 1.2 ? 1 - (t - p) / 1.2 : 0), 0);
  if (t < 2.55) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, translate: `${(1 - enter) * 560}px 0px`, zIndex: go > 0.01 ? 5 : 2 }}>
      <div style={{ position: "absolute", top: -40, left: 0, padding: "6px 14px", borderRadius: 99, background: "rgba(20,13,10,0.88)", border: `1.5px solid ${C.caramel}`, fontFamily: sans, fontWeight: 800, fontSize: 17, letterSpacing: 1.6, color: C.cream, whiteSpace: "nowrap" }}>CUSTOMER'S PHONE · LIVE</div>
      <div style={{ borderRadius: 58, boxShadow: `0 0 ${30 + 60 * pulse}px ${10 * pulse}px rgba(196,138,90,${0.6 * pulse})` }}>
        <PhoneShell height={h}>
          {BEATS.filter((bt) => bt.dock).map((bt) => (
            <Sequence key={bt.id} from={Math.round((bt.start + (bt.dock!.from ?? 0)) * FPS)} durationInFrames={Math.round((bt.len - (bt.dock!.from ?? 0)) * FPS)} layout="none">
              <Sequence from={-Math.round((bt.dock!.from ?? 0) * FPS)} layout="none"><Parts clipName={bt.dock!.clip} parts={bt.dock!.parts} /></Sequence>
            </Sequence>
          ))}
          {/* beat B: the customer's own taps, played in the phone while it is in the centre */}
          <Sequence from={Math.round(B.start * FPS)} durationInFrames={Math.round(B.pop!.out * FPS + 0.3 * FPS)} layout="none"><Parts clipName={B.pop!.clip} parts={B.pop!.parts} /></Sequence>
        </PhoneShell>
      </div>
    </div>
  );
};

/** a trigger phone (craftsman, rider) popping up in the centre over the owner's screen */
const Pop: React.FC<{ beat: Beat }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const p = beat.pop!;
  const pin = spring({ frame: frame - Math.round(p.at * FPS), fps: FPS, config: { damping: 18, stiffness: 120, mass: 0.85 } });
  const pout = ease((t - p.out) / 0.45);
  if (t > p.out + 0.5) return null;
  const w = phoneW(CENTER.h);
  return (
    <>
      <div style={{ position: "absolute", left: OW.x, top: OW.y, width: OW.w, height: OW.h, borderRadius: 22, background: "rgba(10,6,4,0.55)", opacity: Math.min(pin, 1 - pout) }} />
      <div style={{ position: "absolute", left: CENTER.x - w / 2, top: CENTER.y, opacity: 1 - pout, scale: String((0.82 + 0.18 * pin) * (1 - 0.12 * pout)), translate: `0px ${(1 - pin) * 60 + pout * 40}px` }}>
        <div style={{ position: "absolute", top: -40, left: 0, padding: "6px 14px", borderRadius: 99, background: C.caramel, fontFamily: sans, fontWeight: 900, fontSize: 17, letterSpacing: 1.6, color: C.espresso, whiteSpace: "nowrap" }}>{p.label}'S PHONE</div>
        <PhoneShell height={CENTER.h}><Parts clipName={p.clip} parts={p.parts} /></PhoneShell>
      </div>
    </>
  );
};

/** the whole owner relay (26.88 -> 64.32 s) */
const Relay: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const winIn = ease(t / 0.5);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: OW.x, top: OW.y, width: OW.w, height: OW.h, opacity: winIn }}>
        <Window x={0} y={0} w={OW.w} h={OW.h} label="Owner · laptop">
          {BEATS.map((bt) => (
            <Sequence key={bt.id} name={bt.id} from={Math.round(bt.start * FPS)} durationInFrames={Math.round(bt.len * FPS)} premountFor={FPS}>
              <OwnerBeat beat={bt} />
            </Sequence>
          ))}
        </Window>
      </div>
      {BEATS.filter((bt) => bt.pop && !bt.pop.fromDock).map((bt) => (
        <Sequence key={bt.id} from={Math.round(bt.start * FPS)} durationInFrames={Math.round(bt.len * FPS)}>
          <Pop beat={bt} />
        </Sequence>
      ))}
      <Dock />
      {BEATS.map((bt) => (
        <Sequence key={`fx-${bt.id}`} from={Math.round(bt.start * FPS)} durationInFrames={Math.round(bt.len * FPS)}>
          {bt.beams.map((bm, i) => <Beam key={i} {...bm} />)}
          <Caption tag={bt.tag} text={bt.text} x={80} y={1040} size={44} out={bt.len - 0.25} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------ timeline
const OPEN: { id: string; start: number; len: number; C: React.FC }[] = [
  { id: "hook", start: 0, len: b(10), C: Hook },
  { id: "design", start: b(10), len: b(20), C: Design },
  { id: "ar", start: b(30), len: b(16), C: Ar },
  { id: "sync-order", start: b(46), len: b(10), C: SyncOrder },
];

const SFX70: Sfx[] = [
  ...SFX60.filter((s) => s.t < RELAY_START - 0.2),
  { t: RELAY_START - 0.12, kind: "whoosh", gain: -14 },
  ...BEATS.flatMap((bt) => bt.sfx.map((s) => ({ ...s, t: RELAY_START + bt.start + s.t }))),
  { t: END_START - 0.12, kind: "whoosh", gain: -13 },
  { t: END_START + 0.9, kind: "pop", gain: -10 },
];

const Progress: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return <div style={{ position: "absolute", left: 0, bottom: 0, height: 5, width: `${(t / D70_SECONDS) * 100}%`, background: `linear-gradient(90deg, ${C.mocha}, ${C.caramel})`, boxShadow: `0 0 12px ${C.caramel}` }} />;
};

/** 1:10 demo, 1920x1080 @ 60 fps */
export const Demo70: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.espresso }}>
    {OPEN.map((s) => (
      <Sequence key={s.id} name={s.id} from={Math.round(s.start * FPS)} durationInFrames={Math.round(s.len * FPS)} premountFor={FPS}>
        <s.C />
      </Sequence>
    ))}
    <Sequence name="owner relay" from={Math.round(RELAY_START * FPS)} durationInFrames={Math.round((END_START - RELAY_START) * FPS)} premountFor={FPS}>
      <Relay />
    </Sequence>
    <Sequence name="end" from={Math.round(END_START * FPS)} durationInFrames={Math.round((D70_SECONDS - END_START) * FPS)} premountFor={FPS}>
      <EndCard len={D70_SECONDS - END_START} />
    </Sequence>
    <Progress />
    <Audio src={staticFile("audio/demo70-music.mp3")} name="Music (125 BPM, 70 s)" volume={(f) => db(mix(-4, -40, ease((f / FPS - 69.1) / 0.9)))} />
    {SFX70.filter((s) => s.t >= 0 && s.t < D70_SECONDS - 0.3).map((s, i) => (
      <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(2.2 * FPS)} name={`SFX ${s.kind}`}>
        <Audio src={staticFile(`audio/${s.kind}.wav`)} volume={db(s.gain)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
