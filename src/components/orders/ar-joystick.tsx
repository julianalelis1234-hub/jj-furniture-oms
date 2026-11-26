"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SPEED = 0.6; // metres per second at full tilt

/**
 * On-screen joystick for the AR camera view: drag the knob to slide the piece
 * across the floor (up = away from you, down = toward you, left / right).
 */
export function ArJoystick({ onMove, disabled = false }: { onMove: (right: number, forward: number) => void; disabled?: boolean }) {
  const pad = useRef<HTMLDivElement>(null);
  const tilt = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const move = useRef(onMove);
  useEffect(() => { move.current = onMove; }, [onMove]);

  useEffect(() => {
    if (!active) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { x, y } = tilt.current;
      if (x || y) move.current(x * SPEED * dt, -y * SPEED * dt);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const update = (clientX: number, clientY: number) => {
    const r = pad.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (clientX - (r.left + R)) / R, dy = (clientY - (r.top + R)) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    tilt.current = { x: Math.abs(dx) < 0.12 ? 0 : dx, y: Math.abs(dy) < 0.12 ? 0 : dy };
    setKnob({ x: dx * R * 0.55, y: dy * R * 0.55 });
  };
  const release = () => { tilt.current = { x: 0, y: 0 }; setKnob({ x: 0, y: 0 }); setActive(false); };

  return (
    <div
      ref={pad}
      role="application"
      aria-label="Joystick: drag to move the furniture on the floor"
      data-testid="ar-joystick"
      aria-disabled={disabled || undefined}
      className={`relative size-28 touch-none rounded-full border-[3px] border-white/70 bg-gradient-to-b from-[#e9e7ef] to-[#b9b6c2] shadow-[inset_0_4px_10px_rgb(0_0_0/0.25),0_6px_18px_rgb(0_0_0/0.35)] select-none ${disabled ? "opacity-50" : ""}`}
      onPointerDown={(e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); setActive(true); update(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (active) update(e.clientX, e.clientY); }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="pointer-events-none absolute top-1/2 left-1/2 grid size-[3.75rem] place-items-center rounded-full bg-gradient-to-b from-white to-[#e4e2ea] shadow-[0_3px_8px_rgb(0_0_0/0.3)] transition-transform duration-75"
        style={{ translate: `calc(-50% + ${knob.x}px) calc(-50% + ${knob.y}px)` }}>
        <div className="relative size-11 text-[#7d7990]" aria-hidden>
          <ChevronUp className="absolute top-0 left-1/2 size-4 -translate-x-1/2" strokeWidth={3} />
          <ChevronDown className="absolute bottom-0 left-1/2 size-4 -translate-x-1/2" strokeWidth={3} />
          <ChevronLeft className="absolute top-1/2 left-0 size-4 -translate-y-1/2" strokeWidth={3} />
          <ChevronRight className="absolute top-1/2 right-0 size-4 -translate-y-1/2" strokeWidth={3} />
        </div>
      </div>
    </div>
  );
}
