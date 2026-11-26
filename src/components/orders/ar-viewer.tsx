"use client";

import { Camera, Check, Copy, Download, Hand, Loader2, RotateCcw, Ruler, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type * as THREE from "three";
import { detectAr, furnitureForAr, launchQuickLook, prepareQuickLook, startWebXr, type ArMode, type WebXrHandle } from "./ar";
import { ArHud } from "./ar-hud";
import { askMotionPermission, startCameraView, type CameraViewHandle } from "./camera-view";
import Furniture3DPreview, { type Furniture3DSpec } from "./Furniture3DPreview";

type XrState = "idle" | "starting" | "searching" | "aim" | "placed";

/**
 * Full-screen 3D view with "View in your room". Customer side only.
 * iPhone → one "View in your room" button: the camera view with joystick and Take photo,
 *   and an "Exact size" button inside it for Apple AR Quick Look;
 * Android → WebXR in Chrome (joystick, Take photo with camera access); otherwise a plain message.
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
  // iPhone "joystick camera view"
  const cam = useRef<CameraViewHandle | null>(null);
  const camHost = useRef<HTMLDivElement>(null);
  const camVideo = useRef<HTMLVideoElement>(null);
  const [camState, setCamState] = useState<"off" | "starting" | "on">("off");
  const [camPlace, setCamPlace] = useState<"searching" | "aim" | "placed">("searching");
  const [shot, setShot] = useState<"idle" | "busy" | "added" | "failed">("idle");
  // the photo just taken, waiting for the customer to choose what to do with it
  const [review, setReview] = useState<{ file: File; url: string; saved: boolean } | null>(null);
  const reviewUrl = review?.url;
  useEffect(() => () => { if (reviewUrl) URL.revokeObjectURL(reviewUrl); }, [reviewUrl]);
  const [xrPhoto, setXrPhoto] = useState(false); // Android: Chrome granted camera access

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !xr.current && !cam.current) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      xr.current?.end();
      cam.current?.end();
      back?.focus?.();
    };
  }, [onClose]);

  const name = `${spec.design_variant} ${spec.furniture_category}`;

  const viewInRoom = async () => {
    if (busy) return;
    setError(null);
    if (mode === "quicklook") {
      startCam(); // the joystick camera view; Exact size inside it opens Apple AR
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
        ended: () => { xr.current = null; setXrState("idle"); setShot("idle"); setReview(null); setUsedAr(true); },
      });
      setXrPhoto(xr.current.canPhoto);
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

  const startCam = () => {
    if (!furniture.current || camState !== "off") return;
    setError(null);
    const motion = askMotionPermission(); // must start inside the tap
    const model = furnitureForAr(furniture.current);
    flushSync(() => setCamState("starting")); // the video and canvas host must exist first
    motion
      .then((ok) => startCameraView(model, camHost.current!, camVideo.current!, ok, {
        tracking: (found) => setCamPlace((p) => (p === "placed" ? p : found ? "aim" : "searching")),
        placed: () => setCamPlace("placed"),
      }))
      .then((h) => { cam.current = h; setCamState("on"); })
      .catch((e) => {
        console.warn("[AR] camera view could not start:", e);
        setCamState("off");
        setError("The camera could not start. Allow camera access for this site in Settings › Safari › Camera, then try again.");
      });
  };
  const stopCam = () => { cam.current?.end(); cam.current = null; setCamState("off"); setCamPlace("searching"); setShot("idle"); setReview(null); setUsedAr(true); };
  /** iPhone: Apple AR Quick Look at true size (synchronous: Safari needs it inside the tap) */
  const exactSize = () => {
    if (!qlUrl) return;
    if (cam.current) stopCam(); // free the camera for Apple AR
    launchQuickLook(qlUrl, name);
    setUsedAr(true);
  };
  const takePhoto = async () => {
    const source = cam.current ?? (xr.current?.canPhoto ? xr.current : null);
    if (!source || shot === "busy") return;
    setShot("busy");
    try {
      const file = await source.photo();
      // nothing is added or saved until the customer chooses
      setReview({ file, url: URL.createObjectURL(file), saved: false });
      setShot("idle");
    } catch (e) {
      console.warn("[AR] photo failed:", e);
      setShot("failed");
    }
  };
  const photoButton = (
    <button type="button" onClick={takePhoto} disabled={shot === "busy"} data-testid="ar-take-photo"
      className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-base font-bold text-black shadow-lg disabled:opacity-70">
      {shot === "busy" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
      {shot === "added" ? "Take another photo" : "Take photo"}
    </button>
  );
  /** take the piece off the floor: the ring comes back and the next tap places it again */
  const placeAgain = () => {
    setShot("idle");
    if (cam.current) { cam.current.pickUp(); setCamPlace("searching"); return; }
    if (xr.current) { const onFloor = xr.current.pickUp(); setXrState(onFloor ? "aim" : "searching"); }
  };
  const placeAgainButton = (
    <button type="button" onClick={placeAgain} data-testid="ar-place-again"
      className="inline-flex h-12 items-center gap-2 rounded-full bg-black/65 px-4 text-base font-bold text-white shadow-lg">
      <Hand className="size-5" aria-hidden /> Place again
    </button>
  );
  const addToOrder = () => {
    if (!review) return;
    window.dispatchEvent(new CustomEvent("jj:room-photo", { detail: review.file }));
    setReview(null);
    setShot("added");
  };
  /** the phone's share sheet has "Save Image" / "Save to Photos"; otherwise a download */
  const saveToPhone = async () => {
    if (!review) return;
    const files = [review.file];
    try {
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, title: "My room with the furniture" });
      } else {
        const a = document.createElement("a");
        a.href = review.url;
        a.download = `jj-room-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setReview((r) => (r ? { ...r, saved: true } : r));
    } catch {
      /* the customer closed the share sheet */
    }
  };
  const reviewPanel = review && (
    <div className="pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black p-5 text-white" role="dialog" aria-label="Your photo" data-testid="ar-photo-review">
      <p className="text-lg font-bold">Keep this photo?</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
      <img src={review.url} alt="The furniture in your room" className="max-h-[52vh] w-auto max-w-full rounded-xl object-contain shadow-lg" />
      <div className="grid w-full max-w-sm gap-2">
        <button type="button" onClick={addToOrder} data-testid="ar-photo-add"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-5 text-base font-bold text-black shadow-lg">
          <Check className="size-5" aria-hidden /> Add to my order
        </button>
        <button type="button" onClick={saveToPhone} data-testid="ar-photo-save"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/60 px-5 text-base font-bold text-white">
          {review.saved ? <Check className="size-5" aria-hidden /> : <Download className="size-5" aria-hidden />} {review.saved ? "Saved to your phone" : "Save to my phone"}
        </button>
        <button type="button" onClick={() => setReview(null)} data-testid="ar-photo-retake"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white/85">
          <RotateCcw className="size-4" aria-hidden /> Retake
        </button>
      </div>
      <p className="max-w-sm text-center text-xs text-white/70">The photo is only added to your order if you tap Add to my order.</p>
    </div>
  );
  const photoNote = shot === "added" ? <b className="text-[#9fd3a4]">Photo added to your order ✓</b>
    : shot === "failed" ? "The photo could not be taken here. Take a screenshot instead." : null;

  const inXr = xrState !== "idle";
  const hint =
    xrState === "starting" ? "Starting the camera…"
    : xrState === "searching" ? "Point your phone at the floor and move it slowly from side to side."
    : xrState === "aim" ? "Tap the screen to put the furniture on the ring."
    : "Drag the joystick to move it. Use the arrows to turn it. Tap Take photo when it looks right.";
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
            <button type="button" onClick={viewInRoom} disabled={busy || camState !== "off"} data-testid="ar-start"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-70 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:w-auto sm:justify-self-start">
              {busy || camState === "starting" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
              View in your room
            </button>
            <p className="text-xs text-muted-foreground">
              {mode === "quicklook"
                ? "Opens your camera with the piece in front of you: move it with the joystick, turn it with the arrows, and tap Take photo to add it to your order. Tap Exact size for Apple AR at its true size."
                : "Shown at its real size. Move it with the joystick, turn it with the arrows, and tap Take photo to add it to your order."}
            </p>
          </>
        )}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        {error && mode === "quicklook" && qlUrl && camState === "off" && (
          <button type="button" onClick={exactSize} data-testid="ar-exact-fallback"
            className="inline-flex h-10 w-fit items-center gap-2 rounded-full border border-primary/50 bg-background px-4 text-sm font-semibold text-primary">
            <Ruler className="size-4" aria-hidden /> Open Apple AR instead
          </button>
        )}
        {usedAr && (
          <p className="rounded-xl bg-accent-soft p-3 text-sm" data-testid="ar-photo-tip">
            Took a photo? Close this view and add it under <b>Photo of your room</b> so the shop can see where it will go.
          </p>
        )}
      </div>

      {/* Android camera view: shown over the camera by Chrome (WebXR DOM overlay). The root lets taps
          through to the floor; only the buttons and the joystick catch them. */}
      <div ref={overlay} className={inXr ? "pointer-events-none fixed inset-0" : "hidden"}>
        {inXr && (
          <ArHud step={xrState === "starting" ? undefined : step} total={3} hint={hint} controls={xrState === "placed"} faded
            note={xrState === "placed" ? (photoNote ?? (xrPhoto ? "Tap Place again to pick it up and put it somewhere else." : "Take a screenshot to save a photo of it in your room. Tap Place again to put it somewhere else.")) : undefined}
            topAction={xrState === "placed" ? placeAgainButton : undefined}
            onDone={() => xr.current?.end()} onRotate={(d) => xr.current?.rotate(d)} onMove={(r, f) => xr.current?.move(r, f)}
            action={xrState === "placed" && xrPhoto ? photoButton : undefined} />
        )}
        {inXr && reviewPanel}
      </div>

      {/* iPhone joystick camera view: rear camera + the furniture drawn over it */}
      {camState !== "off" && (
        <div className="fixed inset-0 z-[70] bg-black" data-testid="ar-camera-layer">
          <video ref={camVideo} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay aria-hidden />
          <div ref={camHost} className="absolute inset-0" />
          <ArHud
            controls={camState === "on" && camPlace === "placed"} faded
            step={camState === "on" ? (camPlace === "placed" ? 3 : camPlace === "aim" ? 2 : 1) : undefined} total={3}
            hint={camState === "starting" ? "Starting the camera…"
              : camPlace === "searching" ? "Point your phone at the floor where you want it."
              : camPlace === "aim" ? "Tap the screen to put the furniture on the ring."
              : "Drag the joystick to move it. Use the arrows to turn it. Tap Take photo when it looks right."}
            note={photoNote ?? (camPlace === "placed" ? "Tap Place again to pick it up and put it somewhere else. The size here is approximate; tap Exact size for Apple AR at its true size." : undefined)}
            topAction={camState === "on" && camPlace === "placed" ? placeAgainButton : undefined}
            onDone={stopCam} onRotate={(d) => cam.current?.rotate(d)} onMove={(r, f) => cam.current?.move(r, f)}
            action={camState === "on" && (
              <div className="flex flex-wrap justify-center gap-2">
                {camPlace === "placed" && photoButton}
                <button type="button" onClick={exactSize} disabled={!qlUrl} data-testid="ar-exact-size"
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-black/65 px-5 text-base font-bold text-white shadow-lg disabled:opacity-60">
                  {qlUrl ? <Ruler className="size-5" aria-hidden /> : <Loader2 className="size-5 animate-spin" aria-hidden />} Exact size
                </button>
              </div>
            )}
          />
          {reviewPanel}
        </div>
      )}
    </div>,
    document.body,
  );
}
