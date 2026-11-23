import { type Anchor, type ClipMeta, warp } from "../clips";
import { scene } from "../timeline";

export type Sfx = { t: number; kind: "click" | "chime" | "whoosh" | "pop" | "swell" };

/** clicks + chimes of a clip, placed on the global timeline through the scene's time warp */
export function clipSfx(sceneId: string, meta: ClipMeta, anchors: Anchor[], offset = 0, window?: [number, number]): Sfx[] {
  const s = scene(sceneId);
  const out: Sfx[] = [];
  for (const e of meta.events) {
    if (e.type !== "click" && e.type !== "chime") continue;
    const local = warp(anchors, e.t) + offset;
    if (window && (local < window[0] || local > window[1])) continue;
    if (local < 0 || s.start + local > s.end) continue;
    out.push({ t: s.start + local, kind: e.type });
  }
  return out;
}
