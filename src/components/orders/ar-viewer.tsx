"use client";

import { Camera, Check, Copy, Loader2, RotateCcw, RotateCw, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type * as THREE from "three";
import { detectAr, furnitureForAr, launchQuickLook, prepareQuickLook, startWebXr, type ArMode, type WebXrHandle } from "./ar";
import { ArJoystick } from "./ar-joystick";
import Furniture3DPreview, { type Furniture3DSpec } from "./Furniture3DPreview";

type XrState = "idle" | "starting" | "searching" | "aim" | "placed";

/**
 * Full-screen 3D view with "View in your room". Customer side only.
 * iPhone → AR Quick Look; Android → WebXR in Chrome; otherwise a plain message.
 */
export function ArViewer({ spec, onClose }: { spec: Furniture3DSpec; onClose: () => void }) {
  const furniture = useRef<THREE.Group | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const xr = useRef<WebXrHandle | null>(null);
  const [mode, setMode] = useState<ArMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [xrState, setXrState] = useState<XrState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [usedAr, setUsedAr] = useState(false);
  const [desktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches);
  const [iphone] = useState(() => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)));
  const [qlUrl, setQlUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // iPhone: make the AR file as soon as the 3D model is on screen, so the tap opens it at once
  useEffect(() => {
    if (mode !== "quicklook") return;
    let live = true, url: string | null = null, tries = 0;
    const wait = setInterval(() => {
      if (!furniture.current && ++tries < 100) return;
      clearInterval(wait);
      if (!furniture.current) { setError("The 3D model did not load. Close this view and try again."); return; }
      prepareQuickLook(furnitureForAr(furniture.current))
        .then((u) => { url = u; if (live) setQlUrl(u); else URL.revokeObjectURL(u); })
        .catch((e) => { console.warn("[AR] could not prepare the iPhone file:", e); if (live) setError("AR could not be prepared on this phone. Please try again."); });
    }, 100);
    return () => { live = false; clearInterval(wait); if (url) URL.revokeObjectURL(url); };
  }, [mode]);

  useEffect(() => {
    let live = true;
    detectAr().then((m) => { if (live) setMode(m); });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const back = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !xr.current) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      xr.current?.end();
      back?.focus?.();
    };
  }, [onClose]);

  const name = `${spec.design_variant} ${spec.furniture_category}`;

  const viewInRoom = async () => {
    if (busy) return;
    setError(null);
    if (mode === "quicklook") {
      if (!qlUrl) return;
      launchQuickLook(qlUrl, name); // synchronous: Safari needs it inside the tap
      setUsedAr(true);
      return;
    }
    if (mode !== "webxr" || !furniture.current || !overlay.current) return;
    setBusy(true);
    try {
      const model = furnitureForAr(furniture.current);
      // the overlay must be visible before Chrome adopts it as the camera view's overlay
      flushSync(() => setXrState("starting"));
      xr.current = await startWebXr(model, overlay.current, {
        tracking: (found) => setXrState((s) => (s === "placed" ? s : found ? "aim" : "searching")),
        placed: () => setXrState("placed"),
        ended: () => { xr.current = null; setXrState("idle"); setUsedAr(true); },
      });
      setXrState((s) => (s === "starting" ? "searching" : s));
    } catch (e) {
      console.warn("[AR] could not start:", e);
      xr.current = null;
      setXrState("idle");
      setError("The camera view could not start. Allow camera access for this site, then try again.");
    } finally {
      setBusy(false);
    }
  };

  const inXr = xrState !== "idle";
  const hint =
    xrState === "starting" ? "Starting the camera…"
    : xrState === "searching" ? "Point your phone at the floor and move it slowly from side to side."
    : xrState === "aim" ? "Tap the screen to put the furniture on the ring."
    : "Drag the joystick to move it. Use the arrows to turn it. Tap the floor to place it somewhere else.";
  const step = xrState === "placed" ? 3 : xrState === "aim" ? 2 : 1;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="ar-title" data-testid="ar-viewer"
      className="fixed inset-0 z-[60] flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-5 sm:py-3">
        <div className="min-w-0 flex-1">
          <h2 id="ar-title" className="truncate text-base font-bold sm:text-lg">See it in your room</h2>
          <p className="truncate text-xs text-muted-foreground">{name} · {spec.width_cm} × {spec.height_cm} × {spec.depth_cm} cm</p>
        </div>
        <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close the full-screen view" data-testid="ar-close"
          className="grid size-10 place-items-center rounded-full border border-border bg-card hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-4">
        <Furniture3DPreview spec={spec} expanded furnitureRef={furniture} className="min-h-0 flex-1" />
      </div>

      <div className="grid gap-2 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5" data-testid="ar-panel">
        {mode === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Checking your phone…</p>
        ) : mode === "none" ? (
          <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm" data-testid="ar-unsupported">
            <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span className="grid gap-2">
              {desktop
                ? "Open this page on your phone to see the piece in your room. You can still turn and zoom the 3D model here."
                : iphone
                  ? "AR opens in Safari. If you opened this page from Messenger, Facebook or another app, copy the link and open it in Safari."
                  : "AR isn't supported on this phone. You can still turn and zoom the 3D model above."}
              {iphone && !desktop && (
                <button type="button" data-testid="ar-copy-link"
                  onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true)).catch(() => {})}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-full border border-primary/50 bg-background px-4 text-sm font-semibold text-primary">
                  {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Link copied" : "Copy link for Safari"}
                </button>
              )}
            </span>
          </p>
        ) : (
          <>
            <button type="button" onClick={viewInRoom} disabled={busy || (mode === "quicklook" && !qlUrl)} data-testid="ar-start"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-70 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:w-auto sm:justify-self-start">
              {busy || (mode === "quicklook" && !qlUrl) ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
              {mode === "quicklook" && !qlUrl ? "Preparing AR…" : "View in your room"}
            </button>
            <p className="text-xs text-muted-foreground">
              Shown at its real size. {mode === "quicklook"
                ? "To take a photo, tap the white camera button in the AR view."
                : "To take a photo, take a screenshot while it is in your room."}
            </p>
          </>
        )}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        {usedAr && (
          <p className="rounded-xl bg-accent-soft p-3 text-sm" data-testid="ar-photo-tip">
            Took a photo? Close this view and add it under <b>Photo of your room</b> so the shop can see where it will go.
          </p>
        )}
      </div>

      {/* Android camera view: shown over the camera by Chrome (WebXR DOM overlay). The root lets taps
          through to the floor; only the buttons and the joystick catch them. */}
      <div ref={overlay} className={inXr ? "pointer-events-none fixed inset-0 flex flex-col justify-between text-white" : "hidden"}>
        <div className="flex justify-end p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button type="button" onClick={() => xr.current?.end()} data-testid="ar-done"
            className="pointer-events-auto h-12 rounded-full bg-white px-6 text-base font-bold text-black shadow-lg">Done</button>
        </div>
        <div className="grid gap-4 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {xrState === "placed" && (
            <div className="flex items-center justify-center gap-5">
              <button type="button" onClick={() => xr.current?.rotate(-30)} aria-label="Turn left"
                className="pointer-events-auto grid size-14 place-items-center rounded-full bg-black/65 shadow-lg"><RotateCcw className="size-6" aria-hidden /></button>
              <div className="pointer-events-auto"><ArJoystick onMove={(r, f) => xr.current?.move(r, f)} /></div>
              <button type="button" onClick={() => xr.current?.rotate(30)} aria-label="Turn right"
                className="pointer-events-auto grid size-14 place-items-center rounded-full bg-black/65 shadow-lg"><RotateCw className="size-6" aria-hidden /></button>
            </div>
          )}
          <div className="rounded-2xl bg-black/75 px-5 py-4 text-center shadow-lg" aria-live="polite" data-testid="ar-instruction">
            {xrState !== "starting" && <p className="text-sm font-semibold text-white/75">Step {step} of 3</p>}
            <p className="mt-1 text-lg leading-snug font-bold">{hint}</p>
            {xrState === "placed" && <p className="mt-2 text-sm text-white/80">Take a screenshot to save a photo of it in your room.</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
