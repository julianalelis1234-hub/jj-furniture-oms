// JJ Enterprises — 1:20 "five roles" cut (1 s zooms; the 1:10 cut is DemoRoles.tsx). 0–25.9 s: the Demo60 opening (hook, AI design + 3D, AR,
// the order landing live). Then five role circles orbit slowly (no logo in the middle); the camera
// zooms into one role at a time (0.5 s), the circle opens into that person's real screen, and zooms
// back out to the orbit: owner or staff confirms + quotes → customer sets a password and accepts →
// production (owner assigns, craftsman builds and ticks every check, owner passes) → delivery (owner
// assigns the rider, the rider delivers) → back to the customer: all seven stages done.
// Every screen is the real app (capture-demo70 + capture-demo80, curated demo data); about real speed.
import { Audio } from "@remotion/media";
import { Briefcase, Crown, Hammer, Truck, User } from "lucide-react";
import React from "react";
import { AbsoluteFill, Freeze, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { C, db, ease, FPS, mix, sans, wordmark } from "../theme";
import type { Anchor } from "./clips60";
import { Ar, Design, EndCard, Hook, SFX as SFX60, type Sfx, SyncOrder } from "./Demo60";
import { Backdrop, Caption, CutClip, PhoneShell, type Seg, type Tag, WarpVideo, Window } from "./kit";

export const ROLES80_SECONDS = 80;
const BEAT = 60 / 125;
const b = (n: number) => +(n * BEAT).toFixed(4);
const ORBIT_START = b(54); // 25.92 s, on the music's breakdown
const END_START = b(156); // 74.88 s, the music's ending hit
const Z = b(2); // a zoom in or out: two beats (0.96 s)
/** each role scene starts half a beat into its slot (its first frame holds while the zoom opens) */
const LEAD = b(1);

// ---------------------------------------------------------------------------- the orbit
type RoleId = "customer" | "owner" | "staff" | "craftsman" | "rider";
const ROLES: { id: RoleId; label: string; Icon: typeof User }[] = [
  { id: "customer", label: "Customer", Icon: User },
  { id: "owner", label: "Owner", Icon: Crown },
  { id: "staff", label: "Staff", Icon: Briefcase },
  { id: "craftsman", label: "Craftsman", Icon: Hammer },
  { id: "rider", label: "Rider", Icon: Truck },
];
const OC = { x: 960, y: 500, rx: 640, ry: 250 };
const SPIN = (2 * Math.PI) / 50; // one turn every 50 s: slow
/** where a role's circle is at orbit time T (seconds since the orbit appeared) */
const orb = (i: number, T: number) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / ROLES.length + SPIN * T;
  const depth = (Math.sin(a) + 1) / 2; // 0 back .. 1 front
  return { x: OC.x + OC.rx * Math.cos(a), y: OC.y + OC.ry * Math.sin(a), s: 0.78 + 0.32 * depth, depth };
};
const roleIndex = (id: RoleId) => ROLES.findIndex((r) => r.id === id);

// ----------------------------------------------------------------------------- role slots
/** times are orbit-relative seconds; each slot includes its zoom in (first 0.48 s) and zoom out (last 0.48 s) */
type Slot = { id: string; target: RoleId; glow?: RoleId[]; from: number; len: number; zoomOut: boolean; done: RoleId[]; C: React.FC<{ L: number }> };
const SLOT = (startBeat: number, beats: number) => ({ from: b(startBeat - 54), len: b(beats) });

const PHONE_H = 960;
const PW = ((PHONE_H - 30) * 390) / 844 + 30;
const LAP = { x: 180, y: 34, w: 1560, h: 878 };

/** a phone recording shown as a few real-speed parts joined by short cross-fades */
const PhoneCuts: React.FC<{ src: string; parts: { c0: number; c1: number; s0: number; s1: number }[] }> = ({ src, parts }) => (
  <>
    {parts.map((p, i) => {
      const pre = i === 0 ? 0 : 0.15;
      const rate = (p.c1 - p.c0) / (p.s1 - p.s0);
      const a: Anchor[] = [[p.c0 - pre * rate, 0], [p.c1, p.s1 - p.s0 + pre]];
      return (
        <Sequence key={i} from={Math.round((p.s0 - pre) * FPS)} durationInFrames={Math.round((p.s1 - p.s0 + pre + (i === parts.length - 1 ? 0 : 0.15)) * FPS)} layout="none">
          <FadeIn on={i > 0}><WarpVideo src={src} anchors={a} /></FadeIn>
        </Sequence>
      );
    })}
  </>
);
const FadeIn: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) => {
  const t = useCurrentFrame() / FPS;
  return <AbsoluteFill style={{ opacity: on ? ease(t / 0.3) : 1 }}>{children}</AbsoluteFill>;
};

/** a device stage: shows from `at` to `to` (slot seconds), sliding in / fading out */
const Stage: React.FC<{ at: number; to: number; children: React.ReactNode; first?: boolean; last?: boolean }> = ({ at, to, children, first, last }) => {
  const t = useCurrentFrame() / FPS;
  if (t < at - 0.01 || t > to + 0.35) return null;
  const pin = first ? 1 : ease((t - at) / 0.35);
  const pout = last ? 0 : ease((t - to) / 0.35);
  return <AbsoluteFill style={{ opacity: Math.min(pin, 1 - pout), translate: `0px ${(1 - pin) * 50}px` }}>{children}</AbsoluteFill>;
};
const Laptop: React.FC<{ src: string; segs: Seg[]; label: string }> = ({ src, segs, label }) => (
  <Window {...LAP} label={label}><CutClip src={src} segs={segs} viewW={LAP.w} viewH={LAP.h} /></Window>
);
const Phone: React.FC<{ label: string; children: React.ReactNode; x?: number }> = ({ label, children, x = 960 - PW / 2 }) => (
  <div style={{ position: "absolute", left: x, top: 40 }}>
    <div style={{ position: "absolute", top: -2, left: 0, translate: "0 -100%", padding: "6px 14px", borderRadius: 99, background: C.caramel, fontFamily: sans, fontWeight: 900, fontSize: 17, letterSpacing: 1.6, color: C.espresso, whiteSpace: "nowrap" }}>{label}</div>
    <PhoneShell height={PHONE_H}>{children}</PhoneShell>
  </div>
);
const Steps: React.FC<{ items: { at: number; text: string }[]; x?: number }> = ({ items, x = 1240 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: x, top: 300, display: "grid", gap: 22 }}>
      {items.map((s, i) => {
        const p = spring({ frame: frame - Math.round(s.at * FPS), fps: FPS, config: { damping: 18, stiffness: 120 } });
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 18, opacity: p, translate: `${(1 - p) * 50}px 0px` }}>
            <div style={{ width: 50, height: 50, borderRadius: 99, display: "grid", placeItems: "center", background: C.caramel, color: C.espresso, fontFamily: wordmark, fontWeight: 900, fontSize: 26 }}>{i + 1}</div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 34, color: C.latte, maxWidth: 560 }}>{s.text}</div>
          </div>
        );
      })}
    </div>
  );
};
const Cap: React.FC<{ tag: Tag; text: string; at?: number; out?: number }> = ({ tag, text, at = 0.6, out }) => <Caption tag={tag} text={text} at={at} out={out} x={80} y={1045} size={42} />;

// 1 · owner or staff: confirm + quotation ----------------------------------------------------------------------
const OwnerSlot: React.FC<{ L: number }> = ({ L }) => (
  <AbsoluteFill>
    <Backdrop />
    <Laptop src="clips/d70-quote.mp4" label="Owner or staff · laptop" segs={[
      { c0: 1.3, c1: 2.7, s0: 0, s1: 1.2, shots: [{ at: 0, dur: 0, scale: 1.45, box: { x: 985, y: 197, width: 911, height: 164 } }] },
      { c0: 4.5, c1: 5.75, s0: 1.2, s1: 2.2, shots: [{ at: 0, dur: 0, scale: 1.55, box: { x: 464, y: 760, width: 900, height: 260 } }] },
      { c0: 7.7, c1: 11.3, s0: 2.2, s1: L, shots: [{ at: 0, dur: 0, scale: 1.4, cx: 1250, cy: 900 }, { at: 1.2, dur: 0.9, scale: 1.3, cx: 960, cy: 180 }] },
    ]} />
    <Cap tag="OWNER · STAFF" text="Owner or staff confirms and sends the quotation." out={L - 1.0} />
  </AbsoluteFill>
);

// 2 · customer: set the password, open the quotation, accept ---------------------------------------------------
const CustomerSlot: React.FC<{ L: number }> = ({ L }) => (
  <AbsoluteFill>
    <Backdrop />
    <Phone label="CUSTOMER'S PHONE" x={420}>
      <PhoneCuts src="clips/d80-cust.mp4" parts={[
        { c0: 0.6, c1: 2.8, s0: 0, s1: 1.5 },
        { c0: 6.5, c1: 8.6, s0: 1.5, s1: 2.9 },
        { c0: 14.5, c1: 18.0, s0: 2.9, s1: 5.25 },
        { c0: 24.9, c1: 29.2, s0: 5.25, s1: L },
      ]} />
    </Phone>
    <Steps x={1000} items={[{ at: 0.5, text: "Sets a password from the email" }, { at: 2.9, text: "Chooses installment, cash at the shop" }, { at: 5.3, text: "Accepts the quotation" }]} />
    <Cap tag="CUSTOMER" text="The customer sets a password and accepts the quotation." out={L - 1.0} />
  </AbsoluteFill>
);

// 3 · production: owner assigns, craftsman builds + checks, owner passes ----------------------------------------
const ProductionSlot: React.FC<{ L: number }> = ({ L }) => {
  return (
    <AbsoluteFill>
      <Backdrop />
      <Stage at={0} to={2.4} first>
        <Laptop src="clips/d70-release.mp4" label="Owner · laptop" segs={[
          { c0: 7.3, c1: 8.8, s0: 0, s1: 1.2, shots: [{ at: 0, dur: 0, scale: 1.5, cx: 1000, cy: 640 }] },
          { c0: 10.3, c1: 11.9, s0: 1.2, s1: 2.75, shots: [{ at: 0, dur: 0, scale: 1.45, cx: 1050, cy: 700 }] },
        ]} />
      </Stage>
      <Stage at={2.4} to={8.6}>
        <Phone label="CRAFTSMAN'S PHONE" x={420}>
          <Sequence from={Math.round(2.4 * FPS)} layout="none">
            <PhoneCuts src="clips/d80-craft.mp4" parts={[
              { c0: 2.0, c1: 3.6, s0: 0, s1: 1.3 },
              { c0: 4.0, c1: 5.6, s0: 1.3, s1: 2.5 },
              { c0: 9.9, c1: 13.6, s0: 2.5, s1: 5.1 },
              { c0: 15.3, c1: 16.4, s0: 5.1, s1: 6.55 },
            ]} />
          </Sequence>
        </Phone>
        <Steps x={1000} items={[{ at: 2.6, text: "Builds from the 3D job card" }, { at: 3.7, text: "Cuts by the parts list" }, { at: 4.9, text: "Ticks every requirement" }, { at: 7.5, text: "Sends it to the owner" }]} />
      </Stage>
      <Stage at={8.6} to={L} last>
        <Laptop src="clips/d70-pass.mp4" label="Owner · laptop" segs={[
          { c0: 1.0, c1: 4.2, s0: 8.6, s1: L, shots: [{ at: 0, dur: 0, scale: 1.4, box: { x: 469, y: 646, width: 1238, height: 155 } }] },
        ]} />
      </Stage>
      <Cap tag="OWNER" text="The owner assigns craftsman Nolito." out={2.3} />
      <Cap tag="CRAFTSMAN" text="Built, then every requirement checked." at={2.6} out={8.45} />
      <Cap tag="OWNER" text="The owner passes the inspection." at={8.75} out={L - 1.0} />
    </AbsoluteFill>
  );
};

// 4 · delivery: owner assigns the rider, the rider delivers -----------------------------------------------------
const DeliverySlot: React.FC<{ L: number }> = ({ L }) => {
  return (
    <AbsoluteFill>
      <Backdrop />
      <Stage at={0} to={2.6} first>
        <Laptop src="clips/d70-pass.mp4" label="Owner · laptop" segs={[
          { c0: 9.9, c1: 11.3, s0: 0, s1: 1.1, shots: [{ at: 0, dur: 0, scale: 1.5, cx: 1000, cy: 520 }] },
          { c0: 12.6, c1: 14.4, s0: 1.1, s1: 2.95, shots: [{ at: 0, dur: 0, scale: 1.45, cx: 1050, cy: 700 }] },
        ]} />
      </Stage>
      <Stage at={2.6} to={L} last>
        <Phone label="RIDER'S PHONE" x={420}>
          <Sequence from={Math.round(2.6 * FPS)} layout="none">
            <PhoneCuts src="clips/d70-rider.mp4" parts={[
              { c0: 0.6, c1: 3.0, s0: 0, s1: 1.8 },
              { c0: 4.9, c1: 8.6, s0: 1.8, s1: L - 2.6 },
            ]} />
          </Sequence>
        </Phone>
        <Steps x={1000} items={[{ at: 2.9, text: "Opens the delivery" }, { at: 3.8, text: "Starts the trip" }, { at: 5.6, text: "Delivered, cash logged" }]} />
      </Stage>
      <Cap tag="OWNER" text="The owner assigns rider Jesse." out={2.5} />
      <Cap tag="RIDER" text="The rider starts the trip and delivers." at={2.8} out={L - 1.0} />
    </AbsoluteFill>
  );
};

// 5 · back to the customer: every stage done ---------------------------------------------------------------------
const STEP_Y = [751, 832, 910, 991, 1069, 1150, 1232];
const DoneSlot: React.FC<{ L: number }> = ({ L }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <AbsoluteFill>
      <Backdrop />
      <Phone label="CUSTOMER'S PHONE" x={420}>
        <PhoneCuts src="clips/d70-c-deliv.mp4" parts={[
          { c0: 9.6, c1: 11.6, s0: 0, s1: 1.6 },
          { c0: 15.0, c1: 15.0 + (L - 1.6), s0: 1.6, s1: L },
        ]} />
        {STEP_Y.map((y, i) => {
          const at = 2.0 + i * 0.32;
          const p = ease((t - at) / 0.35);
          const fade = 1 - ease((t - at - 0.9) / 0.6);
          if (t < at) return null;
          return <div key={i} style={{ position: "absolute", left: 87 - 34, top: y - 34, width: 68, height: 68, borderRadius: 99, border: `5px solid ${C.caramel}`, boxShadow: `0 0 28px ${C.caramel}`, opacity: p * Math.max(0.0, fade), scale: String(0.6 + 0.4 * p) }} />;
        })}
      </Phone>
      <div style={{ position: "absolute", left: 1000, top: 330 }}>
        <div style={{ fontFamily: sans, fontWeight: 900, fontSize: 22, letterSpacing: 3, color: C.caramel, opacity: ease((t - 0.5) / 0.4) }}>ALL 7 STAGES</div>
        <div style={{ fontFamily: wordmark, fontWeight: 900, fontSize: 80, lineHeight: 1.05, color: C.cream, marginTop: 14, opacity: ease((t - 0.8) / 0.5), translate: `0px ${(1 - ease((t - 0.8) / 0.5)) * 30}px` }}>Done, and<br />tracked live.</div>
      </div>
      <Cap tag="CUSTOMER" text="The customer saw every stage happen, live." at={1.0} />
    </AbsoluteFill>
  );
};

const SLOTS: Slot[] = [
  { id: "owner", target: "owner", glow: ["staff"], ...SLOT(58, 16), zoomOut: true, done: ["owner", "staff"], C: OwnerSlot },
  { id: "customer", target: "customer", ...SLOT(74, 21), zoomOut: true, done: ["customer"], C: CustomerSlot },
  { id: "production", target: "craftsman", glow: ["owner"], ...SLOT(95, 25), zoomOut: true, done: ["craftsman"], C: ProductionSlot },
  { id: "delivery", target: "rider", glow: ["owner"], ...SLOT(120, 18), zoomOut: true, done: ["rider"], C: DeliverySlot },
  { id: "done", target: "customer", ...SLOT(138, 18), zoomOut: false, done: [], C: DoneSlot },
];

/** zoom amount 0..1 for a slot at orbit time T */
const zoomOf = (s: Slot, T: number) => {
  const zin = ease((T - s.from) / Z);
  const zout = s.zoomOut ? ease((T - (s.from + s.len - Z)) / Z) : 0;
  return T < s.from || T > s.from + s.len ? 0 : Math.max(0, zin - zout);
};

const Orbit: React.FC = () => {
  const frame = useCurrentFrame();
  const T = frame / FPS;
  const active = SLOTS.find((s) => T >= s.from && T <= s.from + s.len);
  const z = active ? zoomOf(active, T) : 0;
  const ti = active ? roleIndex(active.target) : 0;
  const tp = orb(ti, T);
  const doneSet = new Set(SLOTS.filter((s) => T >= s.from + s.len - Z * 0.5).flatMap((s) => s.done));
  const order = ROLES.map((r, i) => ({ r, i, p: orb(i, T) })).sort((a, c) => a.p.depth - c.p.depth);
  return (
    <AbsoluteFill>
      <Backdrop />
      {/* the orbit: pushed toward the target circle while zooming in */}
      <AbsoluteFill style={{ transformOrigin: `${tp.x}px ${tp.y}px`, scale: String(1 + 5 * z * z), opacity: 1 - z, filter: z > 0.02 ? `blur(${8 * z}px)` : undefined }}>
        <div style={{ position: "absolute", left: OC.x - OC.rx, top: OC.y - OC.ry, width: OC.rx * 2, height: OC.ry * 2, borderRadius: "50%", border: "2px solid rgba(196,138,90,0.22)", boxShadow: "0 0 60px rgba(196,138,90,0.08)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 930, textAlign: "center", fontFamily: wordmark, fontWeight: 900, fontSize: 52, color: C.cream, opacity: ease((T - 0.6) / 0.5) }}>One order. Five roles. Always in sync.</div>
        {order.map(({ r, i, p }) => {
          const enter = spring({ frame: frame - Math.round((0.15 + i * 0.12) * FPS), fps: FPS, config: { damping: 14, stiffness: 120, mass: 0.8 } });
          const isTarget = active && (r.id === active.target || active.glow?.includes(r.id));
          const glow = isTarget ? 0.6 + 0.4 * Math.sin(T * 8) : 0;
          const done = doneSet.has(r.id);
          const R = 92 * p.s;
          return (
            <div key={r.id} style={{ position: "absolute", left: p.x - R, top: p.y - R, width: R * 2, height: R * 2, opacity: enter * (0.55 + 0.45 * p.depth + 0.0), scale: String(enter) }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: 99, background: "radial-gradient(circle at 35% 30%, #5a3d2c, #2a1a12)", border: `3px solid ${C.caramel}`, boxShadow: `0 0 ${30 + 40 * glow}px rgba(196,138,90,${0.35 + 0.5 * glow}), 0 20px 40px -10px rgba(0,0,0,0.7)`, display: "grid", placeItems: "center" }}>
                <r.Icon color={C.cream} size={R * 0.8} strokeWidth={1.8} />
              </div>
              <div style={{ position: "absolute", top: R * 2 + 10, left: "50%", translate: "-50% 0", fontFamily: sans, fontWeight: 800, fontSize: 26 * p.s, letterSpacing: 1, color: C.cream, whiteSpace: "nowrap", textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}>{r.label}</div>
              {done && <div style={{ position: "absolute", right: -4, top: -4, width: R * 0.62, height: R * 0.62, borderRadius: 99, background: C.success, color: C.espresso, display: "grid", placeItems: "center", fontFamily: wordmark, fontWeight: 900, fontSize: R * 0.42, boxShadow: "0 0 18px rgba(127,183,126,0.7)" }}>✓</div>}
            </div>
          );
        })}
      </AbsoluteFill>
      {/* the role's screen opens out of its circle */}
      {SLOTS.map((s) => {
        if (T < s.from - 0.02 || T > s.from + s.len + 0.02) return null;
        const zz = zoomOf(s, T);
        const pp = orb(roleIndex(s.target), T);
        const r = mix(90, 2400, zz);
        return (
          <AbsoluteFill key={s.id} style={{ clipPath: `circle(${r}px at ${pp.x}px ${pp.y}px)`, opacity: Math.min(1, zz * 1.6), transformOrigin: `${pp.x}px ${pp.y}px`, scale: String(mix(0.25, 1, zz)) }}>
            <Sequence from={Math.round(s.from * FPS)} durationInFrames={Math.round(LEAD * FPS)} premountFor={FPS}>
              <Freeze frame={0}><s.C L={s.len - LEAD} /></Freeze>
            </Sequence>
            <Sequence from={Math.round((s.from + LEAD) * FPS)} durationInFrames={Math.round((s.len - LEAD) * FPS)} premountFor={FPS}>
              <s.C L={s.len - LEAD} />
            </Sequence>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------- timeline
const OPEN: { id: string; start: number; len: number; C: React.FC }[] = [
  { id: "hook", start: 0, len: b(10), C: Hook },
  { id: "design", start: b(10), len: b(20), C: Design },
  { id: "ar", start: b(30), len: b(16), C: Ar },
  { id: "sync-order", start: b(46), len: b(8), C: SyncOrder },
];

const at = (id: string) => ORBIT_START + SLOTS.find((s) => s.id === id)!.from + LEAD;
const SFX: Sfx[] = [
  ...SFX60.filter((s) => s.t < ORBIT_START - 0.2),
  { t: ORBIT_START - 0.1, kind: "whoosh", gain: -13 },
  { t: ORBIT_START + 0.1, kind: "swell", gain: -12 },
  ...ROLES.map((_, i) => ({ t: ORBIT_START + 0.2 + i * 0.12, kind: "pop" as const, gain: -17 })),
  // zooms: in at each slot start, out at each slot end
  ...SLOTS.flatMap((s) => [{ t: ORBIT_START + s.from - 0.05, kind: "whoosh" as const, gain: -15 }, ...(s.zoomOut ? [{ t: ORBIT_START + s.from + s.len - Z, kind: "whoosh" as const, gain: -17 }] : [])]),
  // owner
  { t: at("owner") + 0.75, kind: "click", gain: -14 }, { t: at("owner") + 1.3, kind: "click", gain: -15 }, { t: at("owner") + 2.65, kind: "click", gain: -14 }, { t: at("owner") + 3.0, kind: "chime", gain: -11 },
  // customer
  { t: at("customer") + 0.9, kind: "click", gain: -16 }, { t: at("customer") + 1.6, kind: "chime", gain: -13 }, { t: at("customer") + 3.15, kind: "click", gain: -15 }, { t: at("customer") + 4.9, kind: "click", gain: -15 }, { t: at("customer") + 5.6, kind: "click", gain: -14 }, { t: at("customer") + 6.35, kind: "chime", gain: -10 },
  // production
  { t: at("production") + 0.55, kind: "click", gain: -15 }, { t: at("production") + 1.35, kind: "click", gain: -14 }, { t: at("production") + 2.55, kind: "pop", gain: -14 },
  ...[0, 1, 2, 3].map((i) => ({ t: at("production") + 5.0 + i * 0.7, kind: "click" as const, gain: -15 })),
  { t: at("production") + 7.6, kind: "click", gain: -14 }, { t: at("production") + 8.1, kind: "chime", gain: -11 }, { t: at("production") + 9.0, kind: "click", gain: -15 }, { t: at("production") + 10.4, kind: "chime", gain: -11 },
  // delivery
  { t: at("delivery") + 0.6, kind: "click", gain: -15 }, { t: at("delivery") + 1.75, kind: "click", gain: -14 }, { t: at("delivery") + 2.75, kind: "pop", gain: -14 }, { t: at("delivery") + 3.15, kind: "click", gain: -15 }, { t: at("delivery") + 4.0, kind: "click", gain: -15 }, { t: at("delivery") + 5.6, kind: "click", gain: -14 }, { t: at("delivery") + 6.2, kind: "chime", gain: -9 },
  // all stages done
  { t: at("done") + 1.2, kind: "chime", gain: -12 },
  ...STEP_Y.map((_, i) => ({ t: at("done") + 2.0 + i * 0.32, kind: "pop" as const, gain: -19 })),
  { t: at("done") + 4.4, kind: "swell", gain: -14 },
  { t: END_START + 0.9, kind: "pop", gain: -10 },
];

const Progress: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return <div style={{ position: "absolute", left: 0, bottom: 0, height: 5, width: `${(t / ROLES80_SECONDS) * 100}%`, background: `linear-gradient(90deg, ${C.mocha}, ${C.caramel})`, boxShadow: `0 0 12px ${C.caramel}` }} />;
};

const EndIn: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return <AbsoluteFill style={{ opacity: ease(t / 0.45) }}><EndCard len={ROLES80_SECONDS - END_START} /></AbsoluteFill>;
};

/** 1:20 five-roles cut, 1920x1080 @ 60 fps */
export const DemoRoles80: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.espresso }}>
    {OPEN.map((s) => (
      <Sequence key={s.id} name={s.id} from={Math.round(s.start * FPS)} durationInFrames={Math.round(s.len * FPS)} premountFor={FPS}>
        <s.C />
      </Sequence>
    ))}
    <Sequence name="five roles orbit" from={Math.round(ORBIT_START * FPS)} durationInFrames={Math.round((END_START - ORBIT_START) * FPS)} premountFor={FPS}>
      <Orbit />
    </Sequence>
    <Sequence name="end" from={Math.round(END_START * FPS)} durationInFrames={Math.round((ROLES80_SECONDS - END_START) * FPS)}>
      <EndIn />
    </Sequence>
    <Progress />
    <Audio src={staticFile("audio/roles80-music.mp3")} name="Music (125 BPM, 80 s)" volume={(f) => db(mix(-4, -40, ease((f / FPS - 79.1) / 0.9)))} />
    {SFX.filter((s) => s.t >= 0 && s.t < ROLES80_SECONDS - 0.3).map((s, i) => (
      <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(2.2 * FPS)} name={`SFX ${s.kind}`}>
        <Audio src={staticFile(`audio/${s.kind}.wav`)} volume={db(s.gain)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
