import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { type Anchor, type ClipMeta, CLIPS, warp } from "../clips";
import { Captions } from "../components/Captions";
import { SceneShell } from "../components/SceneShell";
import { C, db, FPS, mix } from "../theme";
import type { TransitionKind } from "../timeline";
import { makeSchedule, type Scheduled } from "../vo";
import { Hub, type HubRole } from "./Hub";
import { CLOSE_AT, HOLO_ANCHORS, P90_ACCEPT_ANCHORS, P90_DRIVER_ANCHORS, P90_GATE, P90_STAFF_ANCHORS, P90_WORKSHOP, P90Accept, P90Customer, P90Driver, P90Finale, P90Gate, P90Home, P90Staff, P90Workshop, RECEIPT_AT, TRACK_AT } from "./Scenes90";
import { SCRIPT_90 } from "./script90";

export const P90_SECONDS = 90;

type HubCfg = { target: HubRole; popAt?: number; hoverAt: number; clickAt: number; diveDur: number; title?: string };
type Spec = { id: string; start: number; end: number; in?: { kind: TransitionKind; dur: number }; comp?: React.FC; hub?: HubCfg };

/** The 1:30 brief, second by second (each window starts where its entrance transition begins). */
export const SCENES_90: Spec[] = [
  { id: "home", start: 0, end: 6.0, comp: P90Home },
  { id: "hub-customer", start: 5.3, end: 12.0, in: { kind: "dissolve", dur: 0.7 }, hub: { target: "Customer", popAt: 0.7, hoverAt: 3.2, clickAt: 5.2, diveDur: 1.5 } },
  { id: "customer", start: 11.0, end: 28.0, in: { kind: "zoomThrough", dur: 1.0 }, comp: P90Customer },
  { id: "hub-staff", start: 27.3, end: 30.2, in: { kind: "zoomOut", dur: 0.7 }, hub: { target: "Staff", hoverAt: 1.0, clickAt: 2.3, diveDur: 0.6, title: "Next: the shop counter" } },
  { id: "staff", start: 29.7, end: 38.0, in: { kind: "zoomThrough", dur: 0.5 }, comp: P90Staff },
  { id: "accept", start: 37.3, end: 50.0, in: { kind: "slideLeft", dur: 0.7 }, comp: P90Accept },
  { id: "gate", start: 49.3, end: 57.0, in: { kind: "slideLeft", dur: 0.7 }, comp: P90Gate },
  { id: "hub-craftsmen", start: 56.3, end: 59.5, in: { kind: "zoomOut", dur: 0.7 }, hub: { target: "Craftsmen", hoverAt: 0.9, clickAt: 2.3, diveDur: 0.9, title: "Next: the workshop" } },
  { id: "workshop", start: 59.0, end: 71.0, in: { kind: "zoomThrough", dur: 0.5 }, comp: P90Workshop },
  { id: "hub-rider", start: 70.3, end: 73.5, in: { kind: "zoomOut", dur: 0.7 }, hub: { target: "Delivery Rider", hoverAt: 0.9, clickAt: 2.3, diveDur: 0.9, title: "Next: on the road" } },
  { id: "driver", start: 73.0, end: 79.0, in: { kind: "zoomThrough", dur: 0.5 }, comp: P90Driver },
  { id: "finale", start: 78.3, end: 90.0, in: { kind: "crossZoom", dur: 0.7 }, comp: P90Finale },
];
const at = (id: string) => SCENES_90.find((s) => s.id === id)!.start;

export const SCHEDULE_90: Scheduled[] = makeSchedule(SCRIPT_90, "p90-");

/* ------------------------------------------------------------------ sound */
type Fx = { t: number; kind: "whoosh" | "pop" | "click" | "chime" | "swell" };
const clipFx = (meta: ClipMeta, anchors: Anchor[], sceneStart: number, offset = 0): Fx[] =>
  meta.events
    .filter((e) => e.type === "click" || e.type === "chime")
    .map((e) => ({ e, local: warp(anchors, e.t) }))
    .filter(({ local }) => local >= anchors[0][1] && local <= anchors[anchors.length - 1][1])
    .map(({ e, local }) => ({ t: sceneStart + offset + local, kind: e.type as "click" | "chime" }));

export const SFX_90: Fx[] = (() => {
  const fx: Fx[] = [{ t: 1.4, kind: "swell" }];
  for (const s of SCENES_90) {
    if (s.in) fx.push({ t: s.start, kind: "whoosh" });
    if (s.hub) {
      if (s.hub.popAt !== undefined) for (let i = 0; i < 5; i++) fx.push({ t: s.start + s.hub.popAt + i * 0.25, kind: "pop" });
      fx.push({ t: s.start + s.hub.clickAt, kind: "click" }, { t: s.start + s.hub.clickAt + 0.1, kind: "whoosh" });
    }
  }
  const c = at("customer");
  fx.push(...clipFx(CLIPS.s3, HOLO_ANCHORS, c).filter((f) => f.kind === "click"));
  for (const t of [0.3, 0.55]) fx.push({ t: c + 9.0 + t, kind: "whoosh" }); // camera pan down
  fx.push({ t: c + 13.5, kind: "click" }, { t: c + RECEIPT_AT, kind: "chime" });
  fx.push(...clipFx(CLIPS.s4, P90_STAFF_ANCHORS, at("staff")));
  fx.push(...clipFx(CLIPS.s5, P90_ACCEPT_ANCHORS, at("accept")));
  fx.push(...clipFx(CLIPS.s6, P90_GATE.S6A, at("gate")), ...clipFx(CLIPS.s6o, P90_GATE.S6OA, at("gate"), P90_GATE.OWNER_AT));
  fx.push(...clipFx(CLIPS.s7, P90_WORKSHOP.S7A, at("workshop")), ...clipFx(CLIPS.s7o, P90_WORKSHOP.S7OA, at("workshop"), P90_WORKSHOP.OWNER_SLIDE));
  fx.push({ t: at("workshop") + P90_WORKSHOP.OWNER_SLIDE, kind: "whoosh" });
  fx.push(...clipFx(CLIPS.s8, P90_DRIVER_ANCHORS, at("driver")));
  fx.push({ t: at("finale") + TRACK_AT + 6 * 0.32 + 0.3, kind: "chime" }, { t: at("finale") + CLOSE_AT, kind: "swell" });
  return fx.sort((a, b) => a.t - b.t).filter((s, i, a) => !a.slice(0, i).some((p) => p.kind === s.kind && Math.abs(p.t - s.t) < 0.12));
})();
const LEVEL = { whoosh: -12, pop: -10, click: -11, chime: -9, swell: -12 } as const;

/** narration activity with a 250 ms attack / release */
function vo(t: number) {
  let a = 0;
  for (const s of SCHEDULE_90) {
    if (!s.hasAudio) continue;
    a = Math.max(a, Math.min(1, Math.max(0, Math.min((t - (s.start - 0.25)) / 0.25, (s.end + 0.25 - t) / 0.25))));
  }
  return a;
}
function transition(t: number) {
  let b = 0;
  for (const s of SCENES_90) if (s.in) { const a = s.start - 0.3; const e = s.start + s.in.dur + 0.3; if (t > a && t < e) b = Math.max(b, Math.sin(Math.PI * ((t - a) / (e - a)))); }
  return b;
}
export function musicDb90(t: number) {
  let l = mix(mix(-18, -14, transition(t)), -22, vo(t));
  if (t < 1.0) l = mix(-40, l, t);
  if (t > 89) l = mix(l, -60, Math.min(1, t - 89)); // 1.0 s audio fade with the picture
  return l;
}

/** JJ Furniture — 1:30 pitch demo (exact flow), 1920x1080 @ 60 fps. */
export const Pitch90: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.espresso }}>
    {SCENES_90.map((s, i) => {
      const next = SCENES_90[i + 1];
      const Comp = s.comp;
      return (
        <Sequence key={s.id} name={s.id} from={Math.round(s.start * FPS)} durationInFrames={Math.round((s.end - s.start) * FPS)} premountFor={FPS}>
          <SceneShell inKind={s.in?.kind} inDur={s.in?.dur} outKind={next?.in?.kind === "zoomThrough" ? undefined : next?.in?.kind} outDur={next ? s.end - next.start : 0}>
            {Comp ? <Comp /> : <Hub {...s.hub!} />}
          </SceneShell>
        </Sequence>
      );
    })}
    <Captions schedule={SCHEDULE_90} />

    <Audio src={staticFile("audio/music-bed.mp3")} volume={(f) => db(musicDb90(f / FPS))} trimAfter={P90_SECONDS * FPS} name="Acoustic bed (ducked)" />
    {SCHEDULE_90.filter((l) => l.hasAudio).map((l) => (
      <Sequence key={l.id} from={Math.round(l.start * FPS)} durationInFrames={Math.ceil((l.end - l.start + 0.2) * FPS)} name={`VO ${l.id}`}>
        <Audio src={staticFile(`vo/${l.id}.mp3`)} />
      </Sequence>
    ))}
    {SFX_90.map((s, i) => (
      <Sequence key={i} from={Math.max(0, Math.round(s.t * FPS) - (s.kind === "whoosh" ? 6 : 0))} durationInFrames={Math.round(2.6 * FPS)} name={`SFX ${s.kind}`}>
        <Audio src={staticFile(`audio/${s.kind}.wav`)} volume={db(LEVEL[s.kind])} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
