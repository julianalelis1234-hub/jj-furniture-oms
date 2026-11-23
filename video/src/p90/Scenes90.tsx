import { CheckCircle2, ReceiptText } from "lucide-react";
import React from "react";
import { AbsoluteFill, Sequence, spring, useCurrentFrame } from "remotion";
import { Camera } from "../components/Camera";
import { Highlight, RoleChip } from "../components/Chrome";
import { Phone } from "../components/Phone";
import { Tree } from "../components/Tree";
import { WarpedClip } from "../components/WarpedClip";
import { type Anchor, CLIPS, ev, evs, warp } from "../clips";
import { GateMeter } from "../scenes/S6Gate";
import { Tracker } from "../scenes/S8Delivery";
import { C, clamp01, ease, FPS, mix, sans, serif } from "../theme";
import { Cursor, Ripple, SPRING90 } from "./Hub";

/* ------------------------------------------------------------------ 0:00 home */
/** 0:00 – 0:06 · settle onto the real homepage, title reveal (local 0 = 0:00). */
export const P90Home: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const settle = ease(t / 1.5);
  const rise = ease((t - 1.5) / 1.0);
  const line = ease((t - 2.1) / 0.8);
  return (
    <AbsoluteFill style={{ backgroundColor: C.espresso }}>
      <AbsoluteFill style={{ scale: String(mix(1.04, 1.0, settle) * (1 + 0.012 * clamp01((t - 1.5) / 4.5))), transformOrigin: "50% 38%" }}>
        <WarpedClip name="s1-home" anchors={[[0.2, 0], [6.4, 6.2]]} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(43,29,23,0.97) 0%, rgba(43,29,23,0.9) 27%, rgba(43,29,23,0) 52%)", opacity: ease((t - 1.2) / 0.8) }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 200 }}>
        <div style={{ overflow: "hidden", paddingBottom: 6 }}>
          <div style={{ fontFamily: serif, fontWeight: 500, fontSize: 88, color: C.cream, translate: `0px ${(1 - rise) * 110}px`, filter: `blur(${8 * (1 - rise)}px)`, opacity: rise, textShadow: "0 6px 30px rgba(0,0,0,0.6)" }}>
            This is JJ&apos;s Furniture Management System
          </div>
        </div>
        <div style={{ width: 820 * line, height: 1, background: C.caramel, boxShadow: `0 0 14px ${C.caramel}`, marginTop: 10 }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.espresso, opacity: 1 - settle }} />
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------- 0:12 customer 3D */
const s3 = CLIPS.s3;
const s3Clicks = evs(s3, "click").filter((c) => c.t > ev(s3, "focus", "dims").t && c.t < ev(s3, "click", "finish").t);
/** hologram crop of the real live 3D preview (local 0 = 0:11.0; stage visible 1.0 – 9.8) */
export const HOLO_ANCHORS: Anchor[] = [
  [ev(s3, "focus", "preview").t, 0],
  [ev(s3, "drag").t, 1.0],
  [ev(s3, "focus", "dims").t, 4.2],
  [Math.min(27.6, ev(s3, "click", "finish").t - 3.0), 9.0], // before the page scrolls away from the preview
  [Math.min(27.9, ev(s3, "click", "finish").t - 2.7), 9.8],
];
const FORM_ANCHORS: Anchor[] = [
  [ev(s3, "click", "finish").t + 4.5, 9.0],
  [ev(s3, "click", "submit").t - 0.6, 13.0],
  [ev(s3, "click", "submit").t, 13.5],
  [ev(s3, "focus", "done").t, 14.0],
  [Math.min(s3.duration - 0.05, ev(s3, "focus", "done").t + 3.6), 17.0],
];
const PILL_CLICKS = s3Clicks.slice(0, 5).map((c) => warp(HOLO_ANCHORS, c.t)); // type, design, width, depth, wood
const FINISH_AT = 9.15;
export const RECEIPT_AT = 13.65;
const STAGE = { x: 520, y: 170, w: 880, h: 880 * (263 / 358) };
const PREVIEW = ev(s3, "focus", "preview").box!;
const PILLS = [
  { label: "Furniture type", x: 150, y: 250 },
  { label: "Design", x: 150, y: 420 },
  { label: "Dimensions", x: 150, y: 590 },
  { label: "Wood", x: 1490, y: 300 },
  { label: "Finish", x: 1490, y: 500 },
];
const PILL_W = 300;

const Pill: React.FC<{ i: number; value: string; activeAt: number; t: number }> = ({ i, value, activeAt, t }) => {
  const p = PILLS[i];
  const on = ease((t - activeAt) / 0.35);
  const bob = Math.sin(t * 1.4 + i * 1.3) * 7;
  const enter = ease((t - (1.2 + i * 0.18)) / 0.6);
  return (
    <div style={{ position: "absolute", left: p.x, top: p.y + bob, width: PILL_W, padding: "14px 20px", borderRadius: 22, background: "rgba(43,29,23,0.9)", border: `1.5px solid ${on > 0.5 ? C.caramel : C.border}`, boxShadow: on > 0.5 ? `0 0 ${24 + 10 * Math.sin(t * 3)}px rgba(196,138,90,0.35)` : "0 16px 40px -12px rgba(0,0,0,0.7)", opacity: enter, translate: `${(1 - enter) * (p.x < 960 ? -30 : 30)}px 0px`, fontFamily: sans }}>
      <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2.5, textTransform: "uppercase", color: C.caramel }}>{p.label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, fontWeight: 700, fontSize: 25, color: C.cream }}>
        {on > 0.5 && <CheckCircle2 size={22} color={C.caramel} />}
        {value}
      </div>
    </div>
  );
};

/** 0:12 – 0:28 · centered live 3D hologram + floating choices → pan to the form → receipt. Local 0 = 0:11.0. */
export const P90Customer: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const k = STAGE.w / PREVIEW.width;
  const pan = ease((t - 9.0) / 0.8); // smooth vertical camera pan down
  const [cType, cDesign, cWidth, cDepth, cWood] = PILL_CLICKS;
  const width = t >= cWidth + 0.3 ? 200 : 180;
  const depth = t >= cDepth + 0.3 ? 95 : 90;
  // cursor visits each pill just before its click (after the drag, where the real cursor is in shot)
  const stops = [
    { at: cType, ...PILLS[0] }, { at: cDesign, ...PILLS[1] }, { at: cWidth, ...PILLS[2] }, { at: cDepth, ...PILLS[2] }, { at: cWood, ...PILLS[3] }, { at: FINISH_AT, ...PILLS[4] },
  ].map((s) => ({ at: s.at, x: s.x + PILL_W - 46, y: s.y + 44 }));
  let cx = stops[0].x - 200, cy = stops[0].y + 120;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const prev = i ? stops[i - 1] : { x: cx, y: cy };
    const p = ease((t - (s.at - 0.55)) / 0.5);
    if (t >= s.at - 0.55) { cx = mix(prev.x, s.x, p); cy = mix(prev.y, s.y, p) - Math.sin(Math.PI * p) * 30; }
  }
  const press = Math.max(0, ...stops.map((s) => 1 - Math.abs(t - s.at) / 0.13));
  const receipt = spring({ frame: frame - Math.round(RECEIPT_AT * FPS), fps: FPS, config: SPRING90 });
  return (
    <AbsoluteFill style={{ backgroundColor: C.espresso, overflow: "hidden" }}>
      <AbsoluteFill style={{ translate: `0px ${-pan * 1080}px` }}>
        {/* studio stage */}
        <AbsoluteFill style={{ background: `radial-gradient(900px 640px at 50% 52%, rgba(196,138,90,0.20), ${C.espresso} 70%)` }}>
          <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", fontFamily: sans, fontWeight: 700, letterSpacing: 5, fontSize: 20, color: C.caramel, textTransform: "uppercase" }}>Live 3D preview · real-scale 165 cm figure</div>
          <div style={{ position: "absolute", left: STAGE.x, top: STAGE.y, width: STAGE.w, height: STAGE.h, borderRadius: 26, overflow: "hidden", border: `1.5px solid ${C.caramel}`, boxShadow: `0 0 ${50 + 12 * Math.sin(t * 2)}px rgba(196,138,90,0.38), inset 0 0 60px rgba(196,138,90,0.2)`, scale: "1.0" }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `scale(${k}) translate(${-PREVIEW.x}px, ${-PREVIEW.y}px)` }}>
              <WarpedClip name="s3-customer" anchors={HOLO_ANCHORS} />
            </div>
            {/* hologram sheen + scanlines */}
            <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, rgba(196,138,90,0.05) 0 2px, transparent 2px 5px)", mixBlendMode: "screen" }} />
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${110 + 20 * Math.sin(t * 0.6)}deg, transparent 35%, rgba(250,246,240,0.07) 50%, transparent 65%)` }} />
          </div>
          <Pill i={0} value="Dining Table" activeAt={cType} t={t} />
          <Pill i={1} value="6-Seater Classic" activeAt={cDesign} t={t} />
          <Pill i={2} value={`${width} × 76 × ${depth} cm`} activeAt={cWidth} t={t} />
          <Pill i={3} value="Mahogany" activeAt={cWood} t={t} />
          <Pill i={4} value="Walnut Stain" activeAt={FINISH_AT} t={t} />
          {stops.map((s, i) => <Ripple key={i} x={s.x} y={s.y} at={s.at} t={t} />)}
          <Cursor x={cx} y={cy} press={press} opacity={ease((t - (cType - 0.9)) / 0.3) * (1 - pan)} />
        </AbsoluteFill>
        {/* the filled-in details form, directly below */}
        <AbsoluteFill style={{ top: 1080 }}>
          <Camera shots={[{ at: 9.5, dur: 0.01, scale: 1.0 }, { at: 13.6, dur: 0.8, scale: 1.0 }]} drift={0.008}>
            <WarpedClip name="s3-customer" anchors={FORM_ANCHORS} />
          </Camera>
        </AbsoluteFill>
      </AbsoluteFill>
      {/* quotation request receipt */}
      {t > RECEIPT_AT - 0.1 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: `rgba(43,29,23,${0.55 * clamp01(receipt)})` }}>
          <div style={{ width: 760, padding: "30px 38px", borderRadius: 26, background: C.card, border: `1.5px solid ${C.caramel}`, boxShadow: "0 0 60px rgba(196,138,90,0.35), 0 40px 90px -20px rgba(0,0,0,0.8)", scale: String(mix(0.92, 1, receipt)), opacity: clamp01(receipt * 1.4), fontFamily: sans, color: C.latte, marginTop: -60 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <ReceiptText size={34} color={C.caramel} />
              <div>
                <div style={{ fontWeight: 700, letterSpacing: 3, fontSize: 16, color: C.caramel, textTransform: "uppercase" }}>Quotation request received</div>
                <div style={{ fontFamily: serif, fontSize: 40, color: C.cream }}>Request DR-1006</div>
              </div>
            </div>
            <div style={{ height: 1, background: C.border, margin: "18px 0" }} />
            {[
              ["Item", "1 × 6-Seater Classic Dining Table"],
              ["Size (W × H × D)", "200 × 76 × 95 cm"],
              ["Wood · Finish", "Mahogany · Walnut Stain"],
              ["Customer", "Andrea Villanueva · Valencia City"],
              ["Status", "Quote Requested — price follows by email"],
            ].map(([k2, v], i) => (
              <div key={k2} style={{ display: "flex", justifyContent: "space-between", fontSize: 23, padding: "6px 0", opacity: ease((t - RECEIPT_AT - 0.25 - i * 0.12) / 0.3) }}>
                <span>{k2}</span><b style={{ color: C.cream }}>{v}</b>
              </div>
            ))}
            <div style={{ marginTop: 14, fontSize: 18, color: C.latte, opacity: 0.85 }}>Becomes order JJ-2026-1006 once the quotation is accepted.</div>
          </div>
        </AbsoluteFill>
      )}
      <RoleChip role="Customer · CU-01" label="Design in 3D & request a quote" delay={1.4} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------ 0:30 staff */
const s4 = CLIPS.s4;
const S4A: Anchor[] = [
  [ev(s4, "click", "row").t - 0.6, 0.5],
  [ev(s4, "focus", "quote-dialog").t, 4.0],
  [ev(s4, "click", "send").t, 7.3],
  [Math.min(s4.duration - 0.05, ev(s4, "click", "send").t + 1.4), 8.3],
];
const priceClick = evs(s4, "click").find((c) => c.t > ev(s4, "focus", "quote-dialog").t)!;
/** 0:30.2 – 0:38 · staff open the request and send the official quotation. Local 0 = 0:29.7. */
export const P90Staff: React.FC = () => (
  <AbsoluteFill>
    <Camera shots={[{ at: 4.1, dur: 0.6, scale: 1.35, cx: priceClick.x!, cy: priceClick.y! - 60 }, { at: 7.0, dur: 0.6, scale: 1.0 }]}>
      <WarpedClip name="s4-staff" anchors={S4A} />
    </Camera>
    <RoleChip role="Staff · S-01" label="Set the price · send the official quotation" delay={0.6} />
  </AbsoluteFill>
);
export const P90_STAFF_ANCHORS = S4A;

/* ------------------------------------------------- 0:38 customer accepts */
const s5 = CLIPS.s5;
const S5A: Anchor[] = [
  [evs(s5, "click")[1].t - 0.6, 0.3], // "Open my quotation"
  [ev(s5, "click", "accept").t, 5.6],
  [ev(s5, "chime", "accepted").t + 0.3, 6.4],
  [ev(s5, "focus", "password-form").t - 0.2, 6.95], // jump (covered by the card slide)
  [ev(s5, "click", "save").t, 11.4],
  [Math.min(s5.duration - 0.05, ev(s5, "focus", "orders").t + 1.6), 12.7],
];
const SLIDE_AT = 6.7;
/** 0:38 – 0:50 · review → accept → create password → order tracker. Local 0 = 0:37.3. */
export const P90Accept: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const p = clamp01((t - (SLIDE_AT - 0.225)) / 0.45);
  const bump = Math.sin(Math.PI * p);
  const form = ev(s5, "focus", "password-form").box!;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ translate: `0px ${-bump * 70}px`, filter: bump > 0.01 ? `blur(${bump * 12}px)` : undefined }}>
        <Camera shots={[{ at: 3.6, dur: 0.6, scale: 1.12, box: { x: 448, y: 380, width: 1024, height: 400 } }, { at: 6.4, dur: 0.3, scale: 1.0 }, { at: 7.0, dur: 0.6, scale: 1.22, box: form }, { at: 11.6, dur: 0.6, scale: 1.0 }]}>
          <WarpedClip name="s5-accept" anchors={S5A} />
          <Highlight box={ev(s5, "focus", "accepted").box!} at={5.7} hold={0.8} />
        </Camera>
      </AbsoluteFill>
      <RoleChip role="Customer · CU-01" label={t < SLIDE_AT ? "Review & accept the quotation" : "Create a secure password"} delay={0.6} />
    </AbsoluteFill>
  );
};
export const P90_ACCEPT_ANCHORS = S5A;

/* ------------------------------------------------------- 0:50 owner gate */
const s6 = CLIPS.s6;
const s6o = CLIPS.s6o;
const S6A: Anchor[] = [
  [ev(s6, "click", "save-payment").t - 2.2, 0.6],
  [ev(s6, "click", "save-payment").t, 2.0],
  [ev(s6, "focus", "gate-after").t, 2.6],
  [Math.min(s6.duration - 0.05, ev(s6, "focus", "gate-after").t + 1.6), 4.3],
];
const OWNER_AT = 4.2;
const S6OA: Anchor[] = [
  [ev(s6o, "click", "release").t - 1.9, 0],
  [ev(s6o, "click", "release").t, 1.5],
  [Math.min(s6o.duration - 0.05, ev(s6o, "click", "release").t + 2.6), 3.6],
];
/** 0:50 – 0:57 · the verified 30% fills the gate, then the owner releases to production. Local 0 = 0:49.3. */
export const P90Gate: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const own = ease((t - OWNER_AT) / 0.45);
  return (
    <AbsoluteFill>
      <Camera shots={[{ at: 1.2, dur: 0.9, scale: 1.42, box: ev(s6, "focus", "gate-after").box }]}>
        <WarpedClip name="s6-gate" anchors={S6A} />
      </Camera>
      <GateMeter at={2.3} />
      <Sequence from={Math.round(OWNER_AT * FPS)} name="owner releases">
        <AbsoluteFill style={{ opacity: own, filter: own < 1 ? `blur(${(1 - own) * 6}px)` : undefined }}>
          <Camera shots={[{ at: 0, dur: 0.01, scale: 1.15, box: { x: 985, y: 60, width: 911, height: 600 } }]}>
            <WarpedClip name="s6-owner" anchors={S6OA} />
          </Camera>
        </AbsoluteFill>
      </Sequence>
      <RoleChip role={t < OWNER_AT ? "Staff · S-01" : "Owner · O-01"} label={t < OWNER_AT ? "Payments & Production Gate" : "Release → In Production"} delay={0.6} />
    </AbsoluteFill>
  );
};
export const P90_GATE = { S6A, S6OA, OWNER_AT };

/* ------------------------------------------- 0:59.5 craftsman → owner pass */
const s7 = CLIPS.s7;
const s7o = CLIPS.s7o;
const S7A: Anchor[] = [
  [evs(s7, "click")[0].t - 0.5, 0.3],
  [ev(s7, "click", "send-owner").t, 5.4],
  [ev(s7, "chime", "for-inspection").t + 0.4, 6.2],
];
const OWNER_SLIDE = 6.0;
const S7OA: Anchor[] = [
  [ev(s7o, "chime", "inspection-arrived").t - 0.3, 0],
  [ev(s7o, "click", "pass").t, 3.8],
  [Math.min(s7o.duration - 0.05, ev(s7o, "chime", "ready-for-delivery").t + 1.8), 6.3],
];
/** 0:59.5 – 1:11 · craftsman phone submits for inspection → slide to the owner, who passes it. Local 0 = 0:59.0. */
export const P90Workshop: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const s = ease((t - OWNER_SLIDE) / 0.6);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 50%, #3a281f, ${C.espresso} 70%)` }}>
      <AbsoluteFill style={{ translate: `${-s * 1920}px 0px` }}>
        <AbsoluteFill style={{ alignItems: "center", paddingTop: 70 }}>
          <Phone height={940}><WarpedClip name="s7-craftsman" anchors={S7A} /></Phone>
        </AbsoluteFill>
        <RoleChip role="Craftsmen · C-01" label="Mark the build complete" delay={0.6} />
      </AbsoluteFill>
      <AbsoluteFill style={{ translate: `${(1 - s) * 1920}px 0px` }}>
        <Sequence from={Math.round(OWNER_SLIDE * FPS)} name="owner passes inspection">
          <Camera shots={[{ at: 0.4, dur: 0.8, scale: 1.3, box: ev(s7o, "focus", "inspection").box }]}>
            <WarpedClip name="s7-owner" anchors={S7OA} />
          </Camera>
          <RoleChip role="Owner · O-01" label="Inspection passed → Ready for Delivery" delay={0.5} />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
export const P90_WORKSHOP = { S7A, S7OA, OWNER_SLIDE };

/* ------------------------------------------------------- 1:13.5 driver */
const s8 = CLIPS.s8;
const S8A: Anchor[] = [
  [ev(s8, "click", "start-trip").t - 1.0, 0.5],
  [ev(s8, "click", "start-trip").t, 1.3],
  [ev(s8, "click", "delivered").t, 4.4],
  [Math.min(s8.duration - 0.05, ev(s8, "focus", "done-card").t + 0.6), 6.0],
];
/** 1:13.5 – 1:19 · the rider starts the trip and confirms delivery. Local 0 = 1:13.0. */
export const P90Driver: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 50%, #3a281f, ${C.espresso} 70%)` }}>
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 70 }}>
      <Phone height={940}><WarpedClip name="s8-driver" anchors={S8A} /></Phone>
    </AbsoluteFill>
    <RoleChip role="Delivery Rider · D-01" label="Start trip → Delivered" delay={0.6} />
  </AbsoluteFill>
);
export const P90_DRIVER_ANCHORS = S8A;

/* ----------------------------------------------- 1:19 tracker + closing */
export const CLOSE_AT = 6.7; // local (1:25.0)
export const TRACK_AT = 1.3;
/** 1:19 – 1:30 · all 7 stages light up on the customer's tracker; closing sign-off. Local 0 = 1:18.3. */
export const P90Finale: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const iris = ease((t - CLOSE_AT) / 0.7);
  const word = ease((t - CLOSE_AT - 0.6) / 0.9);
  const fade = ease((t - 10.7) / 1.0);
  return (
    <AbsoluteFill style={{ backgroundColor: C.espresso }}>
      <AbsoluteFill style={{ opacity: 1 - iris * 0.9 }}>
        <Camera shots={[{ at: 0.6, dur: 1.2, scale: 1.18, box: ev(CLIPS.s8c, "focus", "delivered").box }]}>
          <WarpedClip name="s8-customer" anchors={[[0.3, 0], [7.6, 7.5]]} />
        </Camera>
        <Tracker at={TRACK_AT} />
        <RoleChip role="Customer · CU-01" label="All 7 stages complete" delay={0.6} />
      </AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `circle(${mix(0, 85, iris)}% at 50% 50%)`, background: `radial-gradient(900px 620px at 50% 45%, rgba(196,138,90,${0.24 + 0.05 * Math.sin(t * 1.2)}) 0%, ${C.espresso} 68%)`, alignItems: "center", justifyContent: "center" }}>
        <div style={{ opacity: ease((t - CLOSE_AT - 0.3) / 0.8), scale: String(0.94 + 0.06 * iris) }}><Tree size={200} glow={1.2} /></div>
        <div style={{ marginTop: 28, fontFamily: serif, fontWeight: 500, fontSize: 70, color: C.cream, opacity: word, translate: `0 ${(1 - word) * 18}px` }}>JJ&apos;s Furniture Management System</div>
        <div style={{ width: 620 * word, height: 1, background: C.caramel, boxShadow: `0 0 14px ${C.caramel}`, marginTop: 14 }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.espresso, opacity: fade }} />
    </AbsoluteFill>
  );
};
