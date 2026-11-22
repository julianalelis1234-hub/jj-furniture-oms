import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Camera } from "../components/Camera";
import { RoleChip } from "../components/Chrome";
import { Phone } from "../components/Phone";
import { WarpedClip } from "../components/WarpedClip";
import { type Anchor, CLIPS, ev } from "../clips";
import { C, ease, FPS, sans } from "../theme";
import { clipSfx, type Sfx } from "./sfx";

const d = CLIPS.s8;
const c = CLIPS.s8c;
const startTrip = ev(d, "click", "start-trip");
const delivered = ev(d, "click", "delivered");
const doneCard = ev(d, "focus", "done-card");

export const CUSTOMER_FROM = 8.6; // 3:09.85
export const TRACKER_AT = 10.2;
/** scene-local seconds (0 = 3:01.25) */
export const S8_ANCHORS: Anchor[] = [
  [0, 0],
  [startTrip.t, 2.6],
  [delivered.t, 6.4],
  [doneCard.t, 7.6],
  [Math.min(d.duration - 0.05, doneCard.t + 2.0), 9.4],
];
const S8C_ANCHORS: Anchor[] = [
  [0.3, 0],
  [Math.min(c.duration - 0.05, 9.0), 8.2],
];
const STAGES = ["Waiting for Confirmation", "Confirmed", "In Production", "Completed / For Inspection", "Ready for Delivery", "Out for Delivery", "Delivered"];
export const s8Sfx = (): Sfx[] => [...clipSfx("s8", d, S8_ANCHORS, 0, [0, CUSTOMER_FROM])];

/** Motion graphic of the 7-stage tracker lighting up, node by node. */
export const Tracker: React.FC<{ at?: number }> = ({ at = TRACKER_AT }) => {
  const t = useCurrentFrame() / FPS;
  const show = ease((t - (at - 0.5)) / 0.6);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 118, pointerEvents: "none" }}>
      <div style={{ display: "flex", alignItems: "flex-start", padding: "26px 34px 22px", borderRadius: 24, background: "rgba(43,29,23,0.94)", border: `1px solid ${C.border}`, boxShadow: "0 30px 70px -20px rgba(0,0,0,0.8)", opacity: show, translate: `0 ${(1 - show) * -20}px` }}>
        {STAGES.map((s, i) => {
          const on = ease((t - (at + i * 0.32)) / 0.35);
          const last = i === STAGES.length - 1;
          const pulse = last && on >= 1 ? 0.5 + 0.5 * Math.sin((t - at) * 4) : 0;
          return (
            <React.Fragment key={s}>
              {i > 0 && <div style={{ width: 62, height: 3, marginTop: 23, background: on > 0 ? C.caramel : "#4a3329", opacity: 0.4 + 0.6 * on }} />}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 128 }}>
                <div style={{ width: 48, height: 48, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontWeight: 800, fontSize: 22, color: on > 0.5 ? C.cream : C.latte, background: last ? `rgba(196,138,90,${on})` : `rgba(107,74,58,${on})`, border: `2px solid ${on > 0.5 ? C.caramel : C.border}`, boxShadow: on > 0.5 ? `0 0 ${16 + 18 * pulse}px rgba(196,138,90,${0.5 + 0.3 * pulse})` : undefined }}>
                  {on > 0.5 ? "✓" : i + 1}
                </div>
                <div style={{ marginTop: 10, fontFamily: sans, fontWeight: last ? 800 : 600, fontSize: 17, lineHeight: 1.2, textAlign: "center", color: last && on > 0.5 ? C.cream : C.latte }}>{s}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** 3:02 – 3:18 · driver confirms delivery on the phone; the customer sees Delivered. */
export const S8Delivery: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const toCustomer = ease((t - CUSTOMER_FROM) / 0.7);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 50%, #3a281f, ${C.espresso} 70%)` }}>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 70, opacity: 1 - toCustomer }}>
        <Phone height={940}>
          <WarpedClip name="s8-driver" anchors={S8_ANCHORS} />
        </Phone>
      </AbsoluteFill>
      {t < CUSTOMER_FROM + 0.2 && <RoleChip role="Delivery Driver · D-01" label="Start trip → delivered + cash logged" delay={0.9} />}
      <Sequence from={Math.round(CUSTOMER_FROM * FPS)} name="customer sees Delivered">
        <AbsoluteFill style={{ opacity: toCustomer }}>
          <Camera shots={[{ at: 0.2, dur: 1.2, scale: 1.12, box: ev(c, "focus", "delivered").box }]}>
            <WarpedClip name="s8-customer" anchors={S8C_ANCHORS} />
          </Camera>
          <RoleChip role="Customer · CU-01" label="Delivered — all 7 stages complete" delay={0.5} />
        </AbsoluteFill>
      </Sequence>
      <Tracker />
    </AbsoluteFill>
  );
};
