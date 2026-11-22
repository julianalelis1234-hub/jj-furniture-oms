import s1 from "../public/clips/s1-home.json";
import s3 from "../public/clips/s3-customer.json";
import s4 from "../public/clips/s4-staff.json";
import s5 from "../public/clips/s5-accept.json";
import s6 from "../public/clips/s6-gate.json";
import s6o from "../public/clips/s6-owner.json";
import s7 from "../public/clips/s7-craftsman.json";
import s7o from "../public/clips/s7-owner.json";
import s8 from "../public/clips/s8-driver.json";
import s8c from "../public/clips/s8-customer.json";

export type Box = { x: number; y: number; width: number; height: number };
export type ClipEvent = { t: number; type: string; label?: string; x?: number; y?: number; box?: Box };
export type ClipMeta = { name: string; duration: number; scale?: number; viewport: { width: number; height: number }; events: ClipEvent[] };

export const CLIPS = {
  s1: s1 as ClipMeta,
  s3: s3 as ClipMeta,
  s4: s4 as ClipMeta,
  s5: s5 as ClipMeta,
  s6: s6 as ClipMeta,
  s6o: s6o as ClipMeta,
  s7: s7 as ClipMeta,
  s7o: s7o as ClipMeta,
  s8: s8 as ClipMeta,
  s8c: s8c as ClipMeta,
};

/** first event matching type (+label), with its clip time */
export function ev(meta: ClipMeta, type: string, label?: string): ClipEvent {
  const e = meta.events.find((x) => x.type === type && (label === undefined || x.label === label));
  if (!e) throw new Error(`${meta.name}: no ${type}${label ? `:${label}` : ""} event`);
  return e;
}
export const evs = (meta: ClipMeta, type: string) => meta.events.filter((x) => x.type === type);

/** Piecewise-linear time warp: [clipSeconds, sceneSeconds] anchors, ascending. */
export type Anchor = [number, number];
export function warp(anchors: Anchor[], clipT: number): number {
  if (clipT <= anchors[0][0]) return anchors[0][1] - (anchors[0][0] - clipT);
  for (let i = 1; i < anchors.length; i++) {
    const [c0, s0] = anchors[i - 1];
    const [c1, s1] = anchors[i];
    if (clipT <= c1) return s0 + ((clipT - c0) / (c1 - c0)) * (s1 - s0);
  }
  const [c, s] = anchors[anchors.length - 1];
  return s + (clipT - c);
}
