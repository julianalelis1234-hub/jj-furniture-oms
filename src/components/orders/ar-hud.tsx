"use client";

import { RotateCcw, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { ArJoystick } from "./ar-joystick";

/**
 * The controls drawn over a camera view: Done and the instruction card at the top;
 * at the bottom the joystick between two turn buttons, then the Take photo /
 * Exact size buttons. The root
 * lets taps through (Android: tap the floor to place); only the controls catch them.
 */
export function ArHud({ step, total, hint, note, controls, faded = false, onDone, onRotate, onMove, action, topAction }: {
  step?: number; total?: number; hint: string; note?: ReactNode; controls: boolean;
  /** draw the joystick and turn buttons at 25% opacity so more of the room shows through */
  faded?: boolean;
  onDone: () => void; onRotate: (deg: number) => void; onMove: (right: number, forward: number) => void;
  /** e.g. the Take photo button */
  action?: ReactNode;
  /** shown left of Done, e.g. Place again */
  topAction?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between text-white">
      {/* top: Done, then the instruction card */}
      <div className="grid gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-end gap-2">
          {topAction && <div className="pointer-events-auto mr-auto">{topAction}</div>}
          <button type="button" onClick={onDone} data-testid="ar-done"
            className="pointer-events-auto h-12 rounded-full bg-white px-6 text-base font-bold text-black shadow-lg">Done</button>
        </div>
        <div className="rounded-2xl bg-black/75 px-5 py-3 text-center shadow-lg" aria-live="polite" data-testid="ar-instruction">
          {step != null && total != null && <p className="text-sm font-semibold text-white/75">Step {step} of {total}</p>}
          <p className="mt-0.5 text-base leading-snug font-bold sm:text-lg">{hint}</p>
          {note && <p className="mt-1.5 text-sm text-white/80">{note}</p>}
        </div>
      </div>
      {/* bottom: the joystick console, then Take photo / Exact size */}
      <div className="grid gap-4 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {controls && (
          <div className={`flex items-center justify-center gap-4 ${faded ? "opacity-25" : ""}`} data-testid="ar-console">
            <button type="button" onClick={() => onRotate(-30)} aria-label="Turn left"
              className="pointer-events-auto grid size-12 place-items-center rounded-full bg-black/65 shadow-lg"><RotateCcw className="size-5" aria-hidden /></button>
            <div className="pointer-events-auto"><ArJoystick onMove={onMove} /></div>
            <button type="button" onClick={() => onRotate(30)} aria-label="Turn right"
              className="pointer-events-auto grid size-12 place-items-center rounded-full bg-black/65 shadow-lg"><RotateCw className="size-5" aria-hidden /></button>
          </div>
        )}
        {action && <div className="pointer-events-auto flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
