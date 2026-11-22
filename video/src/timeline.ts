/**
 * Master timeline (seconds). Each scene's window starts where its incoming
 * transition begins, so both scenes are on screen during the overlap.
 * Matches the production brief: 0:00 – 3:30 at 60 fps (12,600 frames).
 */
export type TransitionKind = "dissolve" | "zoomThrough" | "slidePush" | "crossZoom" | "slideLeft" | "rackFocus" | "panUp" | "iris" | "zoomOut";
export type SceneSpec = { id: string; start: number; end: number; in?: { kind: TransitionKind; dur: number }; label?: string; role?: string };

export const SCENES: SceneSpec[] = [
  { id: "s1", start: 0, end: 15 },
  { id: "s2", start: 14.2, end: 32, in: { kind: "dissolve", dur: 0.8 } },
  { id: "s3", start: 30.0, end: 65, in: { kind: "zoomThrough", dur: 2.0 }, role: "Customer · CU-01", label: "Option 2 · Customize & request a quote" },
  { id: "s4", start: 64.2, end: 98, in: { kind: "slidePush", dur: 0.8 }, role: "Staff · S-01", label: "Operations & Order Queue" },
  { id: "s5", start: 97.2, end: 130, in: { kind: "crossZoom", dur: 0.8 }, role: "Customer · CU-01", label: "Quotation review & password setup" },
  { id: "s6", start: 129.2, end: 160, in: { kind: "slideLeft", dur: 0.8 }, role: "Staff · S-01  →  Owner · O-01", label: "Payments & Production Gate" },
  { id: "s7", start: 159.2, end: 182, in: { kind: "rackFocus", dur: 0.8 }, role: "Craftsman · C-01", label: "Workshop progress, synced live" },
  { id: "s8", start: 181.25, end: 198, in: { kind: "panUp", dur: 0.75 }, role: "Delivery Driver · D-01", label: "Delivery confirmation" },
  { id: "s9", start: 197, end: 210, in: { kind: "iris", dur: 1.0 } },
];

export const scene = (id: string) => SCENES.find((s) => s.id === id)!;
/** scene-local seconds -> global seconds */
export const G = (id: string, local: number) => scene(id).start + local;
