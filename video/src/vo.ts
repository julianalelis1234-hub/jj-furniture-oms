import { SCRIPT } from "./script";
import manifest from "./vo-manifest.json";

export type Scheduled = { id: string; text: string; start: number; end: number; hasAudio: boolean };

const durations = manifest as Record<string, number>;
const words = (t: string) => t.split(/\s+/).length;

/**
 * Each line starts at its target time, or just after the previous line ends
 * (whichever is later), so narration never overlaps. Missing audio falls back
 * to a reading-speed estimate and the caption still shows on time.
 */
export const SCHEDULE: Scheduled[] = (() => {
  const out: Scheduled[] = [];
  let prevEnd = 0;
  for (const l of SCRIPT) {
    const dur = durations[l.id] ?? words(l.text) / 2.7 + 0.3;
    const start = Math.max(l.at, prevEnd + 0.35);
    out.push({ id: l.id, text: l.text, start, end: start + dur, hasAudio: l.id in durations });
    prevEnd = start + dur;
  }
  return out;
})();

/** 0..1 how much narration is active at global second t (300 ms attack/release) */
export function voActivity(t: number): number {
  let a = 0;
  for (const s of SCHEDULE) {
    if (!s.hasAudio) continue;
    const up = (t - (s.start - 0.3)) / 0.3;
    const down = (s.end + 0.3 - t) / 0.3;
    a = Math.max(a, Math.min(1, Math.max(0, Math.min(up, down))));
  }
  return a;
}
