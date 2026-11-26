// JJ Enterprises — 60-second pitch demo (customer + owner focus, live sync), 1920x1080 @ 60 fps.
// Every screen is the real app (curated demo data), recorded by capture/capture-demo60.mjs;
// the AR shot is the team's own phone screen recording. Captions + original music, no narration.
// Cuts land on the 125 BPM beat of public/audio/ad-music.mp3 (drop 4.8 s, break ~27 s, hit 53.76 s).
import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Img, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { C, db, ease, FPS, mix, sans, serif, SPRING, wordmark } from "../theme";
import { type Anchor, META, toScene } from "./clips60";
import { Backdrop, Beam, Cam, Caption, CutClip, Cursor, PhonePop, PhoneShell, Punch, Ring, type Seg, Soft, WarpVideo, Window } from "./kit";

export const D60_SECONDS = 60;
const BEAT = 60 / 125;
const b = (n: number) => +(n * BEAT).toFixed(4);

/** clip path helpers */
const clip = (n: string) => `clips/d60-${n}.mp4`;

// ------------------------------------------------------------------- time warps
// [clipSeconds, sceneSeconds]; scenes are local (each starts at 0)
const W = {
  tune: [[21.0, 0], [22.1, 0.55], [22.95, 0.95], [25.75, 1.35], [27.05, 2.0], [28.55, b(6)]] as Anchor[],
  spin: [[10, 0], [27.3, b(6)]] as Anchor[],
  arA: [[3.0, 0], [4.5, 1.2]] as Anchor[],
  arB: [[7.45, 0], [9.4, 1.55]] as Anchor[],
  arC: [[9.55, 0], [17.9, b(16) - 2.75]] as Anchor[],
  submit: [[1.35, 0], [2.7, 0.9], [3.65, 1.5], [6.3, 2.0], [6.8, 2.4], [7.2, b(10)]] as Anchor[],
  arrive: [[1.35, 0], [2.7, 0.9], [3.65, 1.5], [6.3, 2.0], [6.8, 2.4], [9.1, b(10)]] as Anchor[],
  craft: [[0.6, 0], [2.3, 0.6], [4.7, 1.5], [5.6, b(4)]] as Anchor[],
  inspect: [[0.6, 0], [1.7, 0.5], [3.0, 1.0], [3.6, 1.35], [4.6, b(4)]] as Anchor[],
  trip: [[0.6, 0], [2.65, 1.0], [4.6, b(6)]] as Anchor[],
  riderF: [[5.0, 0], [5.5, 0.3], [7.6, 1.2], [8.2, 1.45], [10.8, 1.9], [11.1, b(8)]] as Anchor[],
  doneF: [[5.0, 0], [5.5, 0.3], [7.6, 1.2], [8.2, 1.45], [10.8, 1.9], [11.6, 2.3], [13.5, b(8)]] as Anchor[],
};

const NEXT = { x: 985, y: 197, width: 911, height: 164 };
/** describe it: the first words typed, a soft cut to the finished sentence and Apply */
const DESCRIBE: Seg[] = [
  { c0: 3.05, c1: 4.6, s0: 0, s1: 1.1, shots: [{ at: 0, dur: 0, scale: 1.75, box: { x: 400, y: 394, width: 744, height: 74 } }] },
  { c0: 12.55, c1: 15.4, s0: 1.1, s1: b(8), shots: [{ at: 0, dur: 0, scale: 1.75, box: { x: 400, y: 394, width: 744, height: 74 } }, { at: 1.05, dur: 0.9, scale: 2.0, box: { x: 1161, y: 345, width: 358, height: 263 } }] },
];
// --------------------------------------------------------------------- timeline
type SceneDef = { id: string; start: number; len: number; C: React.FC; dir?: number };

const Scrim: React.FC = () => <AbsoluteFill style={{ background: "linear-gradient(0deg, rgba(12,7,5,0.92) 0%, rgba(12,7,5,0.55) 22%, transparent 42%)", pointerEvents: "none" }} />;

// 0 · hook ------------------------------------------------------------------------
const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const logo = spring({ frame: frame - 12, fps: FPS, config: SPRING });
  const out = ease((t - 4.35) / 0.45);
  const lines = ["Design it.", "See it in your room.", "We build it."];
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ opacity: 0.32 * (1 - out), filter: "blur(14px)", scale: String(1.1 + 0.05 * t / 5) }}>
        <WarpVideo src={clip("3d")} anchors={[[4, 0], [23.2, 4.8]]} />
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 26, scale: String(1 + 0.25 * out), opacity: 1 - out, filter: out > 0 ? `blur(${10 * out}px)` : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30, opacity: logo, scale: String(0.6 + 0.4 * logo) }}>
          <Img src={staticFile("brand/jj-enterprises-logo.png")} style={{ width: 150, height: 150, borderRadius: 99, boxShadow: "0 0 60px rgba(196,138,90,0.45)" }} />
          <div>
            <div style={{ fontFamily: wordmark, fontWeight: 900, fontSize: 92, color: C.cream, letterSpacing: -1.5, lineHeight: 1 }}>JJ Enterprises</div>
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 30, color: C.latte, marginTop: 8 }}>Furniture and Lumber Dealer · Valencia City</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 26, marginTop: 30 }}>
          {lines.map((l, i) => {
            const p = spring({ frame: frame - Math.round((1.55 + i * 0.62) * FPS), fps: FPS, config: { damping: 14, stiffness: 150, mass: 0.7 } });
            return <div key={l} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 64, color: i === 2 ? C.caramel : C.cream, opacity: Math.min(1, p * 1.4), translate: `0px ${(1 - p) * 40}px` }}>{l}</div>;
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 1 · customer designs ---------------------------------------------------------------
const WIN = { x: 90, y: 54, w: 1740, h: 979 };
const Design: React.FC = () => {
  const m = META.customize;
  const S = (a: number) => Math.round(a * FPS);
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sequence durationInFrames={S(b(8))} name="describe it">
        <Punch>
          <Window {...WIN} label="Customer · design online">
            <CutClip src={clip("customize")} segs={DESCRIBE} viewW={WIN.w} viewH={WIN.h} meta={m} />
          </Window>
          <Scrim />
          <Caption tag="CUSTOMER" text="Describe it. The 3D model builds itself." out={b(8) - 0.25} />
        </Punch>
      </Sequence>
      <Sequence from={S(b(8))} durationInFrames={S(b(6))} name="fine-tune">
        <Punch>
          <Window {...WIN} label="Customer · design online">
            <Cam viewW={WIN.w} viewH={WIN.h} shots={[{ at: 0, dur: 0, scale: 1.6, cx: 960, cy: 400 }, { at: 1.3, dur: 0.6, scale: 1.6, cx: 1000, cy: 430 }]}>
              <WarpVideo src={clip("customize")} anchors={W.tune} />
              <Ring box={{ x: 505, y: 515, width: 60, height: 50 }} at={0.3} hold={0.8} />
              <Ring box={{ x: 830, y: 520, width: 260, height: 42 }} at={1.75} hold={0.9} />
              <Cursor meta={m} anchors={W.tune} />
            </Cam>
          </Window>
          <Scrim />
          <Caption tag="CUSTOMER" text="Fine-tune drawers, wood and finish." out={b(6) - 0.25} />
        </Punch>
      </Sequence>
      <Sequence from={S(b(14))} durationInFrames={S(b(6))} name="3D turntable">
        <Punch>
          <Window {...WIN} label="Real-time 3D">
            <Cam viewW={WIN.w} viewH={WIN.h} shots={[{ at: 0, dur: 0, scale: 1.3, cx: 960, cy: 470 }, { at: 0.2, dur: 2.6, scale: 1.45, cx: 960, cy: 480 }]} drift={0}>
              <WarpVideo src={clip("3d")} anchors={W.spin} />
            </Cam>
          </Window>
          <Scrim />
          <Caption tag="CUSTOMER" text="Check every side, true to size." out={b(6) - 0.25} />
        </Punch>
      </Sequence>
    </AbsoluteFill>
  );
};

// 2 · AR -------------------------------------------------------------------------------
const Ar: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const S = (a: number) => Math.round(a * FPS);
  const phoneIn = spring({ frame, fps: FPS, config: SPRING });
  const steps = [
    { at: 1.25, n: "1", text: "Point at the floor" },
    { at: 2.45, n: "2", text: "Tap to place it" },
    { at: 3.3, n: "3", text: "Move it, turn it, take a photo" },
  ];
  const tap = (at: number, x: number, y: number) => {
    const d = t - at;
    if (d < 0 || d > 0.6) return null;
    const p = ease(d / 0.6);
    return <div style={{ position: "absolute", left: x - 50, top: y - 50, width: 100, height: 100, borderRadius: 99, border: "6px solid rgba(255,255,255,0.9)", background: "rgba(255,255,255,0.25)", scale: String(0.3 + 1.6 * p), opacity: 1 - p }} />;
  };
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 250, top: 50, translate: `0px ${(1 - phoneIn) * 120}px`, opacity: phoneIn, rotate: `${(1 - phoneIn) * -4}deg` }}>
        <PhoneShell height={980}>
          <Sequence durationInFrames={S(1.2)}><WarpVideo src="ar/ar-clip.mp4" anchors={W.arA} /></Sequence>
          <Sequence from={S(1.2)} durationInFrames={S(1.55)}><WarpVideo src="ar/ar-clip.mp4" anchors={W.arB} /></Sequence>
          <Sequence from={S(2.75)}><WarpVideo src="ar/ar-clip.mp4" anchors={W.arC} /></Sequence>
          {tap(1.0, 390, 1408)}
          {tap(2.5, 390, 980)}
          {/* white flash on the cut into the camera view */}
          <AbsoluteFill style={{ background: "#fff", opacity: Math.max(0, 1 - Math.abs(t - 1.2) / 0.12) * 0.5 }} />
        </PhoneShell>
      </div>
      <div style={{ position: "absolute", left: 860, top: 230, width: 960 }}>
        <div style={{ fontFamily: sans, fontWeight: 900, fontSize: 22, letterSpacing: 3, color: C.caramel, opacity: ease((t - 0.2) / 0.4) }}>CUSTOMER · AUGMENTED REALITY</div>
        <div style={{ fontFamily: wordmark, fontWeight: 900, fontSize: 92, lineHeight: 1.02, color: C.cream, marginTop: 18 }}>
          {["See", "it", "in", "your", "room", "before", "it's", "built."].map((w, i) => {
            const p = spring({ frame: frame - Math.round((0.3 + i * 0.07) * FPS), fps: FPS, config: { damping: 15, stiffness: 150, mass: 0.7 } });
            return <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: Math.min(1, p * 1.4), translate: `0px ${(1 - p) * 34}px` }}>{w}</span>;
          })}
        </div>
        <div style={{ display: "grid", gap: 18, marginTop: 54 }}>
          {steps.map((s) => {
            const p = spring({ frame: frame - Math.round(s.at * FPS), fps: FPS, config: SPRING });
            return (
              <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 20, opacity: p, translate: `${(1 - p) * 60}px 0px` }}>
                <div style={{ width: 58, height: 58, borderRadius: 99, display: "grid", placeItems: "center", background: C.caramel, color: C.espresso, fontFamily: wordmark, fontWeight: 900, fontSize: 30 }}>{s.n}</div>
                <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 40, color: C.latte }}>{s.text}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 50, fontFamily: sans, fontSize: 24, color: "rgba(231,214,193,0.7)", opacity: ease((t - 4.2) / 0.5) }}>Recorded on a customer's phone · the live site</div>
      </div>
    </AbsoluteFill>
  );
};

// split-screen helper -------------------------------------------------------------------
const L = { x: 60, y: 120, w: 880, h: 720 };
const R = { x: 980, y: 120, w: 880, h: 720 };

// 3 · live sync: order lands on the owner's screen -----------------------------------------
const SyncOrder: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Punch>
      <Window {...L} label="Customer">
        <Cam viewW={L.w} viewH={L.h} shots={[{ at: 0, dur: 0, scale: 1.45, cx: 700, cy: 900 }, { at: 1.15, dur: 0.6, scale: 1.25, box: { x: 672, y: 249, width: 576, height: 586 } }]}>
          <WarpVideo src={clip("submit")} anchors={W.submit} />
          <Cursor meta={META.submit} anchors={W.submit} />
        </Cam>
      </Window>
      <Window {...R} label="Owner">
        <Cam viewW={R.w} viewH={R.h} shots={[{ at: 0, dur: 0, scale: 1.35, cx: 900, cy: 330 }]}>
          <WarpVideo src={clip("arrive")} anchors={W.arrive} />
          <Ring box={{ x: 448, y: 116, width: 310, height: 150 }} at={2.15} hold={2.2} />
        </Cam>
      </Window>
      <Beam x1={900} y1={520} x2={1180} y2={330} at={1.55} />
      <Scrim />
      <Caption tag="LIVE SYNC" text="Order sent. It lands on the owner's screen live." />
    </Punch>
  </AbsoluteFill>
);

// 4 · owner title (music break) ----------------------------------------------------------
const OwnerCard: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const p = spring({ frame, fps: FPS, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const out = ease((t - 1.6) / 0.32);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ opacity: 0.22, filter: "blur(10px)", scale: String(1.15 - 0.05 * t) }}>
        <WarpVideo src={clip("arrive")} anchors={[[8, 0], [10, 1.92]]} />
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", opacity: 1 - out, scale: String((0.8 + 0.2 * p) * (1 + 0.3 * out)) }}>
        <div style={{ fontFamily: sans, fontWeight: 900, fontSize: 30, letterSpacing: 8, color: C.caramel }}>THE OWNER</div>
        <div style={{ fontFamily: wordmark, fontWeight: 900, fontSize: 120, color: C.cream, lineHeight: 1.05, textAlign: "center", marginTop: 12 }}>runs every step</div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 46, color: C.latte, marginTop: 14 }}>quote · terms · payments · workshop · delivery</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 5 · owner: confirm + quote (soft cuts at real speed; the quotation then shows on the customer's phone) ---
const QUOTE: Seg[] = [
  { c0: 5.8, c1: 7.1, s0: 0, s1: 1.05, shots: [{ at: 0, dur: 0, scale: 1.45, box: NEXT }] },
  { c0: 9.25, c1: 10.85, s0: 1.05, s1: 2.25, shots: [{ at: 0, dur: 0, scale: 1.55, box: { x: 464, y: 760, width: 900, height: 260 } }] },
  { c0: 12.4, c1: 14.2, s0: 2.25, s1: b(8), shots: [{ at: 0, dur: 0, scale: 1.45, cx: 1250, cy: 900 }, { at: 0.75, dur: 0.8, scale: 1.35, cx: 960, cy: 180 }] },
];
const Quote: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Soft>
      <Window {...WIN} label="Owner · orders & quotations">
        <CutClip src={clip("quote")} segs={QUOTE} viewW={WIN.w} viewH={WIN.h} meta={META.quote} />
      </Window>
      <Scrim />
      <Caption tag="OWNER" text="Confirm and quote in one step." out={b(8) - 0.3} />
      <PhonePop at={2.75} out={b(8) - 0.2}>
        <WarpVideo src={clip("quote-cust")} anchors={[[2.2, 0], [4.2, 1.2]]} />
      </PhonePop>
    </Soft>
  </AbsoluteFill>
);

// 6 · the customer accepts on the phone; the owner's screen updates live -----------------------------------
const ACCEPT_OWNER: Seg[] = [
  { c0: 11.2, c1: 13.6, s0: 0, s1: 3.2, shots: [{ at: 0, dur: 0, scale: 1.45, box: NEXT }] },
  { c0: 16.5, c1: 18.1, s0: 3.2, s1: b(10), shots: [{ at: 0, dur: 0, scale: 1.45, box: NEXT }] },
];
const SyncAccept: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Soft>
      <Window {...WIN} label="Owner · orders & quotations">
        <CutClip src={clip("accepted")} segs={ACCEPT_OWNER} viewW={WIN.w} viewH={WIN.h} />
        <Cam viewW={WIN.w} viewH={WIN.h} shots={[{ at: 0, dur: 0, scale: 1.45, box: NEXT }]} drift={0}>
          <Ring box={NEXT} at={3.75} hold={0.9} />
        </Cam>
      </Window>
      <Scrim />
      <PhonePop at={0.15} out={4.05}>
        <Sequence durationInFrames={Math.round(2.0 * FPS)}><WarpVideo src={clip("accept")} anchors={[[8.2, 0], [10.9, 2.0]]} /></Sequence>
        <Sequence from={Math.round(2.0 * FPS)}><WarpVideo src={clip("accept")} anchors={[[12.9, 0], [15.2, 2.3]]} /></Sequence>
      </PhonePop>
      <Beam x1={1560} y1={700} x2={1080} y2={420} at={3.2} />
      <Caption tag="LIVE SYNC" text="Customer picks installment. The owner sees it live." size={46} />
    </Soft>
  </AbsoluteFill>
);

// 7 · approve the plan, record the cash payment, release; the customer's phone follows ---------------------
const MANAGE: Seg[] = [
  { c0: 2.7, c1: 4.5, s0: 0, s1: 1.45, shots: [{ at: 0, dur: 0, scale: 1.5, box: NEXT }] },
  { c0: 15.9, c1: 17.7, s0: 1.45, s1: 2.85, shots: [{ at: 0, dur: 0, scale: 1.5, cx: 1050, cy: 640 }] },
  { c0: 20.75, c1: 23.6, s0: 2.85, s1: b(12), shots: [{ at: 0, dur: 0, scale: 1.45, cx: 1050, cy: 660 }, { at: 0.95, dur: 0.9, scale: 1.3, cx: 960, cy: 200 }] },
];
const Manage: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Soft>
      <Window {...WIN} label="Owner · payments & gate">
        <CutClip src={clip("manage")} segs={MANAGE} viewW={WIN.w} viewH={WIN.h} meta={META.manage} />
      </Window>
      <Scrim />
      <Caption tag="OWNER" text="Approve the plan. Record payment. Release." out={3.55} />
      <Caption tag="LIVE SYNC" text="The customer's phone follows on its own." at={3.75} size={46} />
      <Beam x1={1100} y1={640} x2={1560} y2={560} at={3.45} />
      <PhonePop at={3.6} out={b(12) - 0.15}>
        <WarpVideo src={clip("live")} anchors={[[24.1, 0], [26.6, 2.2]]} />
      </PhonePop>
    </Soft>
  </AbsoluteFill>
);

// 9 · the other roles, quick ----------------------------------------------------------------------------
const PhoneBeat: React.FC<{ src: string; anchors: Anchor[]; tag: "CRAFTSMAN" | "RIDER"; text: string; sub: string }> = ({ src, anchors, tag, text, sub }) => {
  const frame = useCurrentFrame();
  const p = spring({ frame, fps: FPS, config: SPRING });
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 330, top: 60, translate: `0px ${(1 - p) * 90}px`, opacity: p }}>
        <PhoneShell height={960}><WarpVideo src={src} anchors={anchors} /></PhoneShell>
      </div>
      <div style={{ position: "absolute", left: 900, top: 380, width: 900 }}>
        <Caption tag={tag} text={text} x={0} y={170} size={78} />
        <div style={{ position: "absolute", top: 200, fontFamily: sans, fontSize: 32, color: C.latte, opacity: ease((frame / FPS - 0.5) / 0.4) }}>{sub}</div>
      </div>
    </AbsoluteFill>
  );
};
const Montage: React.FC = () => {
  const S = (a: number) => Math.round(a * FPS);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={S(b(4))} name="craftsman">
        <Punch><PhoneBeat src={clip("craft")} anchors={W.craft} tag="CRAFTSMAN" text="Builds from the 3D job card." sub="Parts list included · no prices on screen" /></Punch>
      </Sequence>
      <Sequence from={S(b(4))} durationInFrames={S(b(4))} name="inspection">
        <Punch dir={-1}>
          <Backdrop />
          <Window {...WIN} label="Owner · dashboard">
            <Cam viewW={WIN.w} viewH={WIN.h} shots={[{ at: 0, dur: 0, scale: 1.45, box: { x: 469, y: 646, width: 1238, height: 155 } }]}>
              <WarpVideo src={clip("inspect")} anchors={W.inspect} />
              <Cursor meta={META.inspect} anchors={W.inspect} />
            </Cam>
          </Window>
          <Scrim />
          <Caption tag="OWNER" text="Passes the quality inspection." />
        </Punch>
      </Sequence>
      <Sequence from={S(b(8))} durationInFrames={S(b(6))} name="rider">
        <Punch><PhoneBeat src={clip("rider")} anchors={W.trip} tag="RIDER" text="Starts the delivery trip." sub="Works offline · syncs when back online" /></Punch>
      </Sequence>
    </AbsoluteFill>
  );
};

// 10 · live sync: delivered, everywhere at once ----------------------------------------------------------
const Delivered: React.FC = () => {
  const frame = useCurrentFrame();
  const p = spring({ frame, fps: FPS, config: SPRING });
  const OW = { x: 540, y: 170, w: 860, h: 620 };
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 90, top: 80, opacity: p, translate: `${(1 - p) * -80}px 0px` }}>
        <div style={{ position: "absolute", top: -6, left: 0, fontFamily: sans, fontWeight: 800, fontSize: 18, letterSpacing: 1.6, color: C.latte }}>RIDER</div>
        <div style={{ marginTop: 26 }}><PhoneShell height={860}><WarpVideo src={clip("rider")} anchors={W.riderF} /></PhoneShell></div>
      </div>
      <Window {...OW} label="Owner" style={{ opacity: p }}>
        <Cam viewW={OW.w} viewH={OW.h} shots={[{ at: 0, dur: 0, scale: 1.25, cx: 1040, cy: 360 }]} drift={0}>
          <WarpVideo src={clip("done-owner")} anchors={W.doneF} />
          <Ring box={{ x: 1215, y: 352, width: 125, height: 186 }} at={2.45} hold={1.3} />
        </Cam>
      </Window>
      <div style={{ position: "absolute", left: 1450, top: 80, opacity: p, translate: `${(1 - p) * 80}px 0px` }}>
        <div style={{ position: "absolute", top: -6, left: 0, fontFamily: sans, fontWeight: 800, fontSize: 18, letterSpacing: 1.6, color: C.latte }}>CUSTOMER</div>
        <div style={{ marginTop: 26 }}><PhoneShell height={860}><WarpVideo src={clip("done-cust")} anchors={W.doneF} /></PhoneShell></div>
      </div>
      <Beam x1={480} y1={520} x2={760} y2={420} at={1.4} />
      <Beam x1={480} y1={560} x2={1470} y2={330} at={1.5} />
      <Caption tag="LIVE SYNC" text="Delivered. Everyone sees it at once." x={540} y={1050} size={46} />
    </AbsoluteFill>
  );
};

// 11 · end card ---------------------------------------------------------------------------------------------
const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const p = spring({ frame, fps: FPS, config: { damping: 13, stiffness: 120, mass: 0.8 } });
  const qr = spring({ frame: frame - Math.round(0.9 * FPS), fps: FPS, config: SPRING });
  const fade = ease((t - 5.55) / 0.65);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ opacity: 0.35, filter: "blur(6px)", translate: "520px 0px", scale: "0.95" }}>
        <WarpVideo src={clip("3d")} anchors={[[22, 0], [40, 6.24]]} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 130, top: 250, opacity: p, translate: `${(1 - p) * -60}px 0px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <Img src={staticFile("brand/jj-enterprises-logo.png")} style={{ width: 120, height: 120, borderRadius: 99, boxShadow: "0 0 50px rgba(196,138,90,0.45)" }} />
          <div style={{ fontFamily: wordmark, fontWeight: 900, fontSize: 84, color: C.cream, letterSpacing: -1.2 }}>JJ Enterprises</div>
        </div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 58, color: C.latte, marginTop: 34, lineHeight: 1.2 }}>Design it. See it in your room.<br /><span style={{ color: C.caramel }}>We build it.</span></div>
        <div style={{ fontFamily: sans, fontSize: 30, color: "rgba(231,214,193,0.85)", marginTop: 34 }}>Customer · Owner · Craftsman · Rider — one live system</div>
      </div>
      <div style={{ position: "absolute", right: 150, top: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: qr, scale: String(0.8 + 0.2 * qr) }}>
        <div style={{ padding: 18, borderRadius: 26, background: C.cream, boxShadow: "0 0 70px rgba(196,138,90,0.35)" }}>
          <Img src={staticFile("brand/qr.svg")} style={{ width: 300, height: 300, display: "block" }} />
        </div>
        <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 32, color: C.cream }}>jj-furniture-oms.vercel.app</div>
      </div>
      <AbsoluteFill style={{ background: "#0d0806", opacity: fade }} />
    </AbsoluteFill>
  );
};

export const SCENES: SceneDef[] = [
  { id: "hook", start: 0, len: b(10), C: Hook },
  { id: "design", start: b(10), len: b(20), C: Design },
  { id: "ar", start: b(30), len: b(16), C: Ar },
  { id: "sync-order", start: b(46), len: b(10), C: SyncOrder },
  { id: "owner-card", start: b(56), len: b(4), C: OwnerCard },
  { id: "quote", start: b(60), len: b(8), C: Quote },
  { id: "sync-accept", start: b(68), len: b(10), C: SyncAccept },
  { id: "manage", start: b(78), len: b(12), C: Manage },
  { id: "montage", start: b(90), len: b(14), C: Montage },
  { id: "delivered", start: b(104), len: b(8), C: Delivered },
  { id: "end", start: b(112), len: 60 - b(112), C: EndCard },
];

// ---------------------------------------------------------------------------- sound
type Sfx = { t: number; kind: "click" | "chime" | "whoosh" | "pop" | "swell"; gain: number };
const at = (id: string) => SCENES.find((s) => s.id === id)!.start;
const clickSfx = (sceneStart: number, meta: keyof typeof META, anchors: Anchor[], from: number, to: number, gain = -12): Sfx[] =>
  META[meta].events.filter((e) => e.type === "click").map((e) => ({ t: sceneStart + toScene(anchors, e.t), kind: "click" as const, gain })).filter((s) => s.t >= sceneStart + from && s.t <= sceneStart + to);

/** scene time of a clip second inside soft-cut segments */
const segAt = (segs: Seg[], c: number) => { const g = segs.find((x) => c >= x.c0 && c <= x.c1); return g ? g.s0 + (c - g.c0) * ((g.s1 - g.s0) / (g.c1 - g.c0)) : -99; };
const segSfx = (sceneStart: number, meta: keyof typeof META, segs: Seg[], gain = -12): Sfx[] =>
  META[meta].events.filter((e) => e.type === "click").map((e) => ({ t: sceneStart + segAt(segs, e.t), kind: "click" as const, gain })).filter((x) => x.t > sceneStart - 1);

const SFX: Sfx[] = [
  { t: 0.05, kind: "swell", gain: -10 },
  { t: 0.2, kind: "pop", gain: -9 },
  ...SCENES.slice(1).filter((s) => !["sync-accept", "manage"].includes(s.id)).map((s) => ({ t: s.start - 0.12, kind: "whoosh" as const, gain: -13 })),
  // design
  ...segSfx(at("design"), "customize", DESCRIBE),
  { t: at("design") + segAt(DESCRIBE, 14.42), kind: "pop", gain: -8 },
  ...clickSfx(at("design") + b(8), "customize", W.tune, 0, b(6)),
  { t: at("design") + b(8) + toScene(W.tune, 22.45), kind: "pop", gain: -9 },
  { t: at("design") + b(8) + toScene(W.tune, 26.6), kind: "pop", gain: -9 },
  // AR taps + placement
  { t: at("ar") + 1.0, kind: "click", gain: -10 },
  { t: at("ar") + 2.5, kind: "click", gain: -10 },
  { t: at("ar") + 2.75, kind: "pop", gain: -7 },
  { t: at("ar") + 1.25, kind: "pop", gain: -14 },
  { t: at("ar") + 2.45, kind: "pop", gain: -14 },
  { t: at("ar") + 3.3, kind: "pop", gain: -14 },
  // live sync moments
  ...clickSfx(at("sync-order"), "submit", W.submit, 0, b(10)),
  { t: at("sync-order") + 1.55, kind: "whoosh", gain: -16 },
  { t: at("sync-order") + 2.15, kind: "chime", gain: -8 },
  { t: at("owner-card"), kind: "swell", gain: -12 },
  ...segSfx(at("quote"), "quote", QUOTE, -14),
  { t: at("quote") + segAt(QUOTE, 13.54), kind: "chime", gain: -12 },
  { t: at("quote") + 2.75, kind: "pop", gain: -13 },
  { t: at("sync-accept") + 0.15, kind: "pop", gain: -13 },
  { t: at("sync-accept") + 1.3, kind: "click", gain: -15 },
  { t: at("sync-accept") + 3.0, kind: "click", gain: -14 },
  { t: at("sync-accept") + 3.2, kind: "whoosh", gain: -18 },
  { t: at("sync-accept") + 3.75, kind: "chime", gain: -9 },
  ...segSfx(at("manage"), "manage", MANAGE, -14),
  { t: at("manage") + segAt(MANAGE, 4.23), kind: "chime", gain: -13 },
  { t: at("manage") + segAt(MANAGE, 17.31), kind: "chime", gain: -13 },
  { t: at("manage") + 3.45, kind: "whoosh", gain: -18 },
  { t: at("manage") + 3.6, kind: "pop", gain: -13 },
  { t: at("manage") + 4.4, kind: "chime", gain: -9 },
  ...clickSfx(at("montage"), "craft", W.craft, 0, b(4), -13),
  ...clickSfx(at("montage") + b(4), "inspect", W.inspect, 0, b(4), -13),
  ...clickSfx(at("montage") + b(8), "rider", W.trip, 0, b(6), -13),
  { t: at("delivered") + 0.3, kind: "click", gain: -12 },
  { t: at("delivered") + 1.2, kind: "click", gain: -12 },
  { t: at("delivered") + 1.4, kind: "whoosh", gain: -16 },
  { t: at("delivered") + 2.0, kind: "chime", gain: -7 },
  { t: at("end") + 0.9, kind: "pop", gain: -10 },
];

const Progress: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return <div style={{ position: "absolute", left: 0, bottom: 0, height: 5, width: `${(t / D60_SECONDS) * 100}%`, background: `linear-gradient(90deg, ${C.mocha}, ${C.caramel})`, boxShadow: `0 0 12px ${C.caramel}` }} />;
};

export const Demo60: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: C.espresso }}>
      {SCENES.map((s) => (
        <Sequence key={s.id} name={s.id} from={Math.round(s.start * FPS)} durationInFrames={Math.round(s.len * FPS)} premountFor={FPS}>
          <s.C />
        </Sequence>
      ))}
      <Progress />
      <Audio src={staticFile("audio/ad-music.mp3")} name="Music (125 BPM)" volume={(f) => db(mix(-4, -40, ease((f / FPS - 59.1) / 0.9)))} />
      {SFX.filter((s) => s.t >= 0 && s.t < D60_SECONDS - 0.3).map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(2.2 * FPS)} name={`SFX ${s.kind}`}>
          <Audio src={staticFile(`audio/${s.kind}.wav`)} volume={db(s.gain)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
