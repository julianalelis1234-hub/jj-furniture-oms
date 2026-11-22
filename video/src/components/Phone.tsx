import React from "react";
import { C } from "../theme";

/** A 390x844 phone (clips are 780x1688, 2x) in a dark bezel. `height` is the outer height on screen. */
export const Phone: React.FC<{ height?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ height = 940, children, style }) => {
  const screenH = height - 36;
  const screenW = (screenH * 390) / 844;
  return (
    <div
      style={{
        position: "relative",
        width: screenW + 36,
        height,
        borderRadius: 64,
        background: "linear-gradient(160deg, #3b2a22, #1a110d)",
        boxShadow: `0 0 0 2px #5a4134, 0 0 60px rgba(196,138,90,0.22), 0 40px 90px -20px rgba(0,0,0,0.8)`,
        padding: 18,
        ...style,
      }}
    >
      <div style={{ position: "relative", width: screenW, height: screenH, borderRadius: 48, overflow: "hidden", background: C.espresso }}>
        <div style={{ position: "absolute", inset: 0, width: 780, height: 1688, transformOrigin: "0 0", transform: `scale(${screenH / 1688})` }}>{children}</div>
        <div style={{ position: "absolute", top: 12, left: "50%", width: 120, height: 32, marginLeft: -60, borderRadius: 20, background: "#0d0806" }} />
      </div>
    </div>
  );
};
