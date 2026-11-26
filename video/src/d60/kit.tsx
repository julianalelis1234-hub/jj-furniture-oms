// Building blocks for the 60-second demo: time-warped clips, a panel camera,
// a 60 fps cursor drawn from the logged moves, frames, captions and the live-sync beam.
import { Video } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { C, ease, FPS, mix, sans, SPRING, wordmark } from "../theme";
import { type Anchor, type Box, type Meta, toClip, toScene } from "./clips60";

/**
 * Plays a recording through a piecewise-linear time warp (anchors are
 * [clipSeconds, sceneSeconds]); each segment is its own <Video> at a constant rate.
 */
export const WarpVideo: React.FC<{ src: string; anchors: Anchor[]; fit?: "cover" | "fill" }> = ({ src, anchors, fit = "cover" }) => (
  <AbsoluteFill>
    {anchors.slice(1).map(([c1, s1], i) => {
      const [c0, s0] = anchors[i];
      if (s1 - s0 < 0.001) return null;
      const from = Math.round(s0 * FPS);
      const dur = Math.max(1, Math.round(s1 * FPS) - from);
      const rate = Math.min(16, Math.max(0.1, (c1 - c0) / (s1 - s0)));
      return (
        <Sequence key={i} from={from} durationInFrames={dur} premountFor={FPS} name={`×${rate.toFixed(2)}`}>
          <Video src={staticFile(src)} trimBefore={Math.round(c0 * FPS)} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: fit }} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

/** A camera move in scene seconds: glide to `scale` centred on a box (clip pixels). */
export type Shot = { at: number; dur?: number; scale: number; box?: Box; cx?: number; cy?: number };

/**
 * Shows a clip (clipW x clipH) inside a view (viewW x viewH), gliding between shots.
 * Children are laid out in clip pixels, so overlays (cursor, highlights) follow the zoom.
 */
export const Cam: React.FC<{ shots: Shot[]; viewW: number; viewH: number; clipW?: number; clipH?: number; drift?: number; children: React.ReactNode }> = ({ shots, viewW, viewH, clipW = 1920, clipH = 1080, drift = 0.01, children }) => {
  const t = useCurrentFrame() / FPS;
  const base = Math.max(viewW / clipW, viewH / clipH); // "cover"
  let cur = { s: 1, cx: clipW / 2, cy: clipH / 2 };
  for (const sh of [...shots].sort((a, b) => a.at - b.at)) {
    if (sh.at > t) break;
    const p = sh.at === 0 && (sh.dur ?? 0) === 0 ? 1 : ease((t - sh.at) / (sh.dur ?? 0.7));
    const to = { s: sh.scale, cx: sh.cx ?? (sh.box ? sh.box.x + sh.box.width / 2 : clipW / 2), cy: sh.cy ?? (sh.box ? sh.box.y + sh.box.height / 2 : clipH / 2) };
    cur = { s: mix(cur.s, to.s, p), cx: mix(cur.cx, to.cx, p), cy: mix(cur.cy, to.cy, p) };
  }
  const s = base * cur.s * (1 + drift * Math.sin(t * 0.6));
  const tx = Math.min(0, Math.max(viewW - clipW * s, viewW / 2 - cur.cx * s));
  const ty = Math.min(0, Math.max(viewH - clipH * s, viewH / 2 - cur.cy * s));
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: clipW, height: clipH, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>{children}</div>
    </div>
  );
};

/** Smooth caramel cursor + click ripples, rebuilt at 60 fps from the recording's move/click log. */
export const Cursor: React.FC<{ meta: Meta; anchors: Anchor[]; scale?: number }> = ({ meta, anchors, scale = 1 }) => {
  const frame = useCurrentFrame();
  const s = frame / FPS;
  const c = toClip(anchors, s);
  const moves = meta.events.filter((e) => e.type === "move");
  if (!moves.length) return null;
  // position at clip time c (same curve as the recorder: ease-out + a gentle arc)
  let x = moves[0].x! + 120, y = moves[0].y! + 80;
  for (const m of moves) {
    if (m.t > c) break;
    const p = Math.min(1, (c - m.t) / Math.max(0.001, (m.ms ?? 600) / 1000));
    const e = 1 - Math.pow(1 - p, 3);
    const arc = Math.sin(Math.PI * p) * Math.min(40, Math.hypot(m.x! - x, m.y! - y) * 0.08);
    x = x + (m.x! - x) * e;
    y = y + (m.y! - y) * e - arc;
  }
  const clicks = meta.events.filter((e) => e.type === "click").map((e) => ({ ...e, s: toScene(anchors, e.t) }));
  const press = clicks.reduce((acc, k) => { const d = s - k.s; return d >= 0 && d < 0.26 ? Math.min(acc, 1 - 0.22 * Math.sin((d / 0.26) * Math.PI)) : acc; }, 1);
  return (
    <>
      {clicks.map((k, i) => {
        const d = s - k.s;
        if (d < 0 || d > 0.6) return null;
        const p = ease(d / 0.6);
        return <div key={i} style={{ position: "absolute", left: k.x! - 22, top: k.y! - 22, width: 44, height: 44, borderRadius: 99, border: `3px solid ${C.caramel}`, background: "rgba(196,138,90,0.3)", scale: String((0.3 + 2.2 * p) * scale), opacity: 1 - p }} />;
      })}
      <div style={{ position: "absolute", left: x - 16 * scale, top: y - 16 * scale, width: 32 * scale, height: 32 * scale, borderRadius: 99, border: `${3 * scale}px solid ${C.caramel}`, background: "rgba(196,138,90,0.22)", boxShadow: "0 0 0 2px rgba(43,29,23,0.55), 0 4px 14px rgba(0,0,0,0.45)", scale: String(press) }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 6 * scale, height: 6 * scale, marginLeft: -3 * scale, marginTop: -3 * scale, borderRadius: 9, background: C.cream }} />
      </div>
    </>
  );
};

/** Pulsing caramel ring around a UI element (clip pixels), shown from scene second `at`. */
export const Ring: React.FC<{ box: Box; at: number; hold?: number; pad?: number }> = ({ box, at, hold = 1.2, pad = 8 }) => {
  const t = useCurrentFrame() / FPS;
  const p = Math.min(ease((t - at) / 0.35), 1 - ease((t - at - hold) / 0.4));
  if (p <= 0) return null;
  const pulse = 0.5 + 0.5 * Math.sin((t - at) * 7);
  return <div style={{ position: "absolute", left: box.x - pad, top: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2, borderRadius: 14, border: `3px solid ${C.caramel}`, boxShadow: `0 0 ${16 + 16 * pulse}px rgba(196,138,90,${0.5 + 0.3 * pulse})`, opacity: p }} />;
};

/** A floating app window: rounded, lit edge, deep shadow. */
export const Window: React.FC<{ x: number; y: number; w: number; h: number; label?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, w, h, label, children, style }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 22, overflow: "hidden", background: C.espresso, boxShadow: `0 0 0 1.5px rgba(231,214,193,0.16), 0 0 70px rgba(196,138,90,0.16), 0 50px 100px -30px rgba(0,0,0,0.85)`, ...style }}>
    <div style={{ position: "absolute", inset: 0 }}>{children}</div>
    {label && (
      <div style={{ position: "absolute", left: 18, top: 16, padding: "7px 16px", borderRadius: 99, background: "rgba(20,13,10,0.82)", border: `1.5px solid rgba(196,138,90,0.7)`, fontFamily: sans, fontWeight: 800, fontSize: 19, letterSpacing: 1.6, textTransform: "uppercase", color: C.cream }}>{label}</div>
    )}
  </div>
);

/** A 390x844 phone; children are laid out at 780x1688. */
export const PhoneShell: React.FC<{ height: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ height, children, style }) => {
  const screenH = height - 30;
  const screenW = (screenH * 390) / 844;
  return (
    <div style={{ position: "relative", width: screenW + 30, height, borderRadius: 58, padding: 15, background: "linear-gradient(150deg, #4a3428, #160e0a)", boxShadow: `0 0 0 2px #6b4c3c, 0 0 80px rgba(196,138,90,0.24), 0 50px 100px -24px rgba(0,0,0,0.85)`, ...style }}>
      <div style={{ position: "relative", width: screenW, height: screenH, borderRadius: 44, overflow: "hidden", background: "#000" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 780, height: 1688, transformOrigin: "0 0", transform: `scale(${screenH / 1688})` }}>{children}</div>
      </div>
    </div>
  );
};

/** Warm studio background with slow light. */
export const Backdrop: React.FC<{ hue?: "warm" | "cool" }> = () => {
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 800px at ${30 + 10 * Math.sin(t * 0.3)}% ${40 + 8 * Math.cos(t * 0.25)}%, #4a3226 0%, #24170f 55%, #140c08 100%)` }}>
      <AbsoluteFill style={{ background: `radial-gradient(700px 500px at ${75 + 6 * Math.cos(t * 0.4)}% 80%, rgba(196,138,90,0.18), transparent 70%)` }} />
    </AbsoluteFill>
  );
};

export type Tag = "CUSTOMER" | "OWNER" | "OWNER · STAFF" | "LIVE SYNC" | "CRAFTSMAN" | "RIDER" | "CUSTOMER · AR";

/** Lower-left caption: role tag + headline, words rise in one by one. */
export const Caption: React.FC<{ tag: Tag; text: string; at?: number; out?: number; x?: number; y?: number; size?: number; maxW?: number }> = ({ tag, text, at = 0.1, out, x = 80, y = 930, size = 50, maxW = 1100 }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const fadeOut = out === undefined ? 1 : 1 - ease((t - out) / 0.25);
  if (t < at - 0.05 || fadeOut <= 0) return null;
  const live = tag === "LIVE SYNC";
  const tagIn = spring({ frame: frame - Math.round(at * FPS), fps: FPS, config: SPRING });
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: "translateY(-100%)", opacity: fadeOut, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", borderRadius: 99, background: live ? "rgba(196,138,90,0.95)" : "rgba(20,13,10,0.85)", border: `2px solid ${C.caramel}`, scale: String(0.7 + 0.3 * tagIn), opacity: tagIn, transformOrigin: "left center" }}>
        <span style={{ width: 11, height: 11, borderRadius: 9, background: live ? C.espresso : C.caramel, opacity: live ? 0.55 + 0.45 * Math.abs(Math.sin(t * 6)) : 1 }} />
        <span style={{ fontFamily: sans, fontWeight: 900, fontSize: 20, letterSpacing: 2.4, color: live ? C.espresso : C.cream }}>{tag}</span>
      </div>
      <div style={{ fontFamily: wordmark, fontWeight: 800, fontSize: size, lineHeight: 1.1, color: C.cream, maxWidth: maxW, textShadow: "0 4px 24px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.9)" }}>
        {words.map((w, i) => {
          const p = spring({ frame: frame - Math.round((at + 0.12 + i * 0.045) * FPS), fps: FPS, config: { damping: 16, stiffness: 160, mass: 0.7 } });
          return <span key={i} style={{ display: "inline-block", marginRight: "0.26em", opacity: Math.min(1, p * 1.5), translate: `0px ${(1 - p) * 26}px` }}>{w}</span>;
        })}
      </div>
    </div>
  );
};

/** Live-sync beam from (x1,y1) to (x2,y2): a glowing line with a travelling spark, then a pulse at the end. */
export const Beam: React.FC<{ x1: number; y1: number; x2: number; y2: number; at: number; dur?: number }> = ({ x1, y1, x2, y2, at, dur = 0.55 }) => {
  const t = useCurrentFrame() / FPS;
  const d = t - at;
  if (d < -0.05 || d > dur + 0.9) return null;
  const p = ease(d / dur);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const fade = 1 - ease((d - dur - 0.3) / 0.5);
  const sx = mix(x1, x2, p), sy = mix(y1, y2, p);
  const ring = ease((d - dur) / 0.6);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fade }}>
      <div style={{ position: "absolute", left: x1, top: y1 - 2, width: len * p, height: 4, borderRadius: 4, transformOrigin: "0 50%", rotate: `${ang}deg`, background: `linear-gradient(90deg, rgba(196,138,90,0.1), ${C.caramel})`, boxShadow: `0 0 18px ${C.caramel}` }} />
      <div style={{ position: "absolute", left: sx - 12, top: sy - 12, width: 24, height: 24, borderRadius: 99, background: C.cream, boxShadow: `0 0 26px 10px ${C.caramel}` }} />
      {d > dur && <div style={{ position: "absolute", left: x2 - 40, top: y2 - 40, width: 80, height: 80, borderRadius: 99, border: `3px solid ${C.caramel}`, scale: String(0.4 + 1.8 * ring), opacity: 1 - ring }} />}
    </AbsoluteFill>
  );
};

/** Beat cut: the incoming scene punches in with a short zoom-blur and quick fade. */
export const Punch: React.FC<{ children: React.ReactNode; dir?: number }> = ({ children, dir = 1 }) => {
  const t = useCurrentFrame() / FPS;
  const p = ease(t / 0.32);
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, t / 0.12), scale: String(1 + 0.07 * (1 - p)), translate: `${dir * 60 * (1 - p)}px 0px`, filter: p < 0.98 ? `blur(${7 * (1 - p)}px)` : undefined }}>
      {children}
    </AbsoluteFill>
  );
};

/**
 * Soft cuts: a recording shown as a few real-speed segments joined by short cross-fades
 * (instead of fast-forwarding the gaps). Each segment has its own camera shots (segment-local
 * seconds) and its own cursor. `seg.c0..c1` (clip seconds) plays over `seg.s0..s1` (scene seconds).
 */
export type Seg = { c0: number; c1: number; s0: number; s1: number; shots: Shot[] };
const XF = 0.18; // half of the cross-fade
export const CutClip: React.FC<{ src: string; segs: Seg[]; viewW: number; viewH: number; clipW?: number; clipH?: number; meta?: Meta }> = ({ src, segs, viewW, viewH, clipW = 1920, clipH = 1080, meta }) => (
  <AbsoluteFill>
    {segs.map((g, i) => {
      const rate = (g.c1 - g.c0) / (g.s1 - g.s0);
      const pre = i === 0 ? 0 : XF;
      const post = i === segs.length - 1 ? 0 : XF;
      const from = Math.round((g.s0 - pre) * FPS);
      const dur = Math.round((g.s1 + post) * FPS) - from;
      const a: Anchor[] = [[g.c0 - pre * rate, 0], [g.c1 + post * rate, (dur) / FPS]];
      return (
        <Sequence key={i} from={from} durationInFrames={dur} premountFor={FPS} name={`cut ${i + 1} ×${rate.toFixed(2)}`}>
          <SegFade first={i === 0}>
            <Cam viewW={viewW} viewH={viewH} clipW={clipW} clipH={clipH} drift={0} shots={g.shots.map((sh) => ({ ...sh, at: sh.at + pre }))}>
              <WarpVideo src={src} anchors={a} />
              {meta && <Cursor meta={meta} anchors={a} />}
            </Cam>
          </SegFade>
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
const SegFade: React.FC<{ first: boolean; children: React.ReactNode }> = ({ first, children }) => {
  const t = useCurrentFrame() / FPS;
  return <AbsoluteFill style={{ opacity: first ? 1 : ease(t / (2 * XF)) }}>{children}</AbsoluteFill>;
};

/** Gentle scene entrance for the calmer owner section: a fade with a slight settle. */
export const Soft: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const t = useCurrentFrame() / FPS;
  const p = ease(t / 0.45);
  return <AbsoluteFill style={{ opacity: p, scale: String(1.015 - 0.015 * p) }}>{children}</AbsoluteFill>;
};

/** The customer's phone popping in at the bottom right (picture in picture), then sliding away. */
export const PhonePop: React.FC<{ at: number; out: number; children: React.ReactNode; height?: number; x?: number; y?: number }> = ({ at, out, children, height = 640, x = 1470, y = 360 }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  if (t < at - 0.02 || t > out + 0.6) return null;
  const pin = spring({ frame: frame - Math.round(at * FPS), fps: FPS, config: { damping: 20, stiffness: 120, mass: 0.9 } });
  const pout = ease((t - out) / 0.5);
  const dx = (1 - pin) * 520 + pout * 520;
  return (
    <div style={{ position: "absolute", left: x, top: y, translate: `${dx}px 0px`, opacity: 1 - pout * 0.6 }}>
      <div style={{ position: "absolute", top: -44, left: 0, padding: "6px 14px", borderRadius: 99, background: "rgba(20,13,10,0.88)", border: `1.5px solid ${C.caramel}`, fontFamily: sans, fontWeight: 800, fontSize: 17, letterSpacing: 1.6, color: C.cream, whiteSpace: "nowrap" }}>CUSTOMER'S PHONE</div>
      {/* children are timed from the moment the phone pops in */}
      <PhoneShell height={height}><Sequence from={Math.round(at * FPS)} layout="none">{children}</Sequence></PhoneShell>
    </div>
  );
};
