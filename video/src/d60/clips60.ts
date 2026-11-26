// Demo60 clip metadata (recorded by capture/capture-demo60.mjs + capture-3d-slowmo.mjs)
// and the time helpers the scenes share.
import accept from "../../public/clips/d60-accept.json";
import accepted from "../../public/clips/d60-accepted.json";
import arrive from "../../public/clips/d60-arrive.json";
import craft from "../../public/clips/d60-craft.json";
import customize from "../../public/clips/d60-customize.json";
import inspect from "../../public/clips/d60-inspect.json";
import manage from "../../public/clips/d60-manage.json";
import quote from "../../public/clips/d60-quote.json";
import rider from "../../public/clips/d60-rider.json";
import submit from "../../public/clips/d60-submit.json";

export type Box = { x: number; y: number; width: number; height: number };
export type Ev = { t: number; type: string; label?: string; x?: number; y?: number; ms?: number; box?: Box };
export type Meta = { name: string; duration: number; events: Ev[] };

export const META: Record<string, Meta> = {
  customize: customize as Meta,
  submit: submit as Meta,
  arrive: arrive as Meta,
  quote: quote as Meta,
  accept: accept as Meta,
  accepted: accepted as Meta,
  manage: manage as Meta,
  craft: craft as Meta,
  inspect: inspect as Meta,
  rider: rider as Meta,
};

/** [clipSeconds, sceneSeconds] pairs, ascending in both. */
export type Anchor = [number, number];

/** clip time -> scene time */
export function toScene(anchors: Anchor[], c: number): number {
  if (c <= anchors[0][0]) return anchors[0][1] - (anchors[0][0] - c);
  for (let i = 1; i < anchors.length; i++) {
    const [c0, s0] = anchors[i - 1];
    const [c1, s1] = anchors[i];
    if (c <= c1) return s0 + ((c - c0) / (c1 - c0)) * (s1 - s0);
  }
  const [c1, s1] = anchors[anchors.length - 1];
  return s1 + (c - c1);
}

/** scene time -> clip time */
export function toClip(anchors: Anchor[], s: number): number {
  if (s <= anchors[0][1]) return anchors[0][0] - (anchors[0][1] - s);
  for (let i = 1; i < anchors.length; i++) {
    const [c0, s0] = anchors[i - 1];
    const [c1, s1] = anchors[i];
    if (s <= s1) return c0 + ((s - s0) / (s1 - s0)) * (c1 - c0);
  }
  const [c1, s1] = anchors[anchors.length - 1];
  return c1 + (s - s1);
}

export const clicks = (m: Meta) => m.events.filter((e) => e.type === "click");
