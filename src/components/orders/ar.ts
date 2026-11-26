"use client";

import * as THREE from "three";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";

/**
 * "See it in your room": the furniture exactly as designed, at true size
 * (1 scene unit = 1 m), placed on the floor through the phone camera.
 *
 *  - iPhone / iPad: Apple AR Quick Look, fed a USDZ file made in the browser
 *    (it has its own shutter button for photos).
 *  - Android: WebXR "immersive-ar" in Chrome with a floor hit test: aim, tap to
 *    place, rotate. With Chrome's "camera-access" feature the page can read the
 *    camera image during a frame, which is how the Take photo button works; the
 *    photo stays on the phone unless the customer adds it to the order.
 *
 * Nothing is uploaded: the model is built from the customer's own design on
 * their phone and thrown away when the view closes.
 */
export type ArMode = "quicklook" | "webxr" | "none";

export async function detectAr(): Promise<ArMode> {
  if (typeof document === "undefined") return "none";
  try {
    if (document.createElement("a").relList?.supports?.("ar")) return "quicklook";
  } catch { /* old browsers */ }
  try {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
    if (xr && (await xr.isSessionSupported("immersive-ar"))) return "webxr";
  } catch { /* not allowed or not supported */ }
  return "none";
}

/** A standalone copy of the furniture: meshes only (no outline helpers), its parts merged under one root. */
export function furnitureForAr(source: THREE.Object3D): THREE.Group {
  const root = new THREE.Group();
  root.name = "jj-furniture";
  const copy = source.clone(true);
  const drop: THREE.Object3D[] = [];
  copy.traverse((o) => {
    // outline helpers (drei <Edges> = LineSegments2, a Mesh with a shader material) are not furniture
    const m = o as THREE.Mesh & { isLine?: boolean; isLineSegments?: boolean; isLine2?: boolean; isLineSegments2?: boolean };
    const mat = m.isMesh ? (Array.isArray(m.material) ? m.material[0] : m.material) : null;
    if (m.isLine || m.isLineSegments || m.isLine2 || m.isLineSegments2 || (m.isMesh && !(mat as THREE.MeshStandardMaterial)?.isMeshStandardMaterial)) drop.push(o);
  });
  drop.forEach((o) => o.parent?.remove(o));
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  root.add(copy);
  root.updateMatrixWorld(true);
  return root;
}

// ------------------------------------------------------------------ iPhone ----
/**
 * Builds the USDZ file in advance (when the full-screen view opens). Safari only
 * opens AR Quick Look from a tap it still counts as "the customer's tap", and a
 * slow export inside the tap handler can lose that, so the tap itself only
 * clicks a ready link (see launchQuickLook).
 */
export async function prepareQuickLook(model: THREE.Object3D): Promise<string> {
  const scene = new THREE.Scene();
  scene.add(model);
  const usdz = await new USDZExporter().parseAsync(scene, {
    quickLookCompatible: true,
    maxTextureSize: 512,
    ar: { anchoring: { type: "plane" }, planeAnchoring: { alignment: "horizontal" } },
  });
  return URL.createObjectURL(new Blob([usdz as BlobPart], { type: "model/vnd.usdz+zip" }));
}

/** Synchronous, inside the tap handler. */
export function launchQuickLook(url: string, name: string) {
  const a = document.createElement("a");
  a.setAttribute("rel", "ar");
  a.setAttribute("download", `${name.replace(/[^A-Za-z0-9-]+/g, "-")}.usdz`);
  // true size (no pinch-to-resize) + Apple's instruction banner along the bottom of the AR view
  const banner = new URLSearchParams({
    allowsContentScaling: "0",
    checkoutTitle: "Drag with one finger to move it · twist two fingers to turn it",
    checkoutSubtitle: "Tap the white camera button to take a photo",
    callToAction: "Done",
  }).toString().replace(/\+/g, "%20");
  a.setAttribute("href", `${url}#${banner}`);
  a.appendChild(document.createElement("img")); // Quick Look needs an <img> child
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ----------------------------------------------------------------- Android ----
/** linear 0–255 -> sRGB 0–255 (the offscreen furniture render is in linear colour) */
const SRGB = Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
});

interface XRSessionLike extends EventTarget {
  end(): Promise<void>;
  requestReferenceSpace(type: string): Promise<unknown>;
  requestHitTestSource?(o: { space: unknown }): Promise<{ cancel(): void }> | undefined;
}

export interface WebXrHandle {
  /** true when Chrome granted camera access, so photo() can work */
  canPhoto: boolean;
  /** camera image + furniture as a JPEG (needs canPhoto) */
  photo(): Promise<File>;
  rotate(deg: number): void;
  /** slide the placed piece along the floor, relative to where the phone points (metres) */
  move(right: number, forward: number): void;
  end(): void;
}

/**
 * Starts the camera AR session. `overlay` is a DOM element shown over the
 * camera (hints and buttons); taps on it never place the model.
 */
export async function startWebXr(model: THREE.Object3D, overlay: HTMLElement, on: {
  placed(): void; tracking(found: boolean): void; ended(): void;
}): Promise<WebXrHandle> {
  const xr = (navigator as Navigator & { xr?: { requestSession(m: string, o: object): Promise<XRSessionLike> } }).xr;
  if (!xr) throw new Error("WebXR is not available");
  const session = await xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "light-estimation", "camera-access"],
    domOverlay: { root: overlay },
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 40);
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a7563", 2.2));
  const sun = new THREE.DirectionalLight("#ffffff", 1.4);
  sun.position.set(1, 3, 2);
  scene.add(sun);

  // aim ring on the floor
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.15, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: "#C48A5A" }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  model.visible = false;
  scene.add(model);

  // DOM-overlay buttons must not also count as "tap the floor"
  const keepTaps = (e: Event) => e.preventDefault();
  overlay.addEventListener("beforexrselect", keepTaps);

  await renderer.xr.setSession(session as unknown as XRSession);
  const viewer = await session.requestReferenceSpace("viewer");
  const hitSource = await session.requestHitTestSource?.({ space: viewer });

  const xrSession = session as unknown as XRSession & { enabledFeatures?: string[] };
  const canPhoto = !!xrSession.enabledFeatures?.includes("camera-access") && typeof XRWebGLBinding !== "undefined";
  let photoReq: { resolve: (f: File) => void; reject: (e: unknown) => void } | null = null;

  let wasTracking = false;
  const camPos = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  session.addEventListener("select", () => {
    if (!reticle.visible) return;
    model.position.setFromMatrixPosition(reticle.matrix);
    // turn the front of the piece toward the customer
    renderer.xr.getCamera().getWorldPosition(camPos);
    model.rotation.set(0, Math.atan2(camPos.x - model.position.x, camPos.z - model.position.z), 0);
    model.visible = true;
    on.placed();
  });

  renderer.setAnimationLoop((_t, frame) => {
    if (frame && hitSource) {
      const ref = renderer.xr.getReferenceSpace();
      const hits = frame.getHitTestResults(hitSource as unknown as XRHitTestSource);
      const pose = hits.length && ref ? hits[0].getPose(ref) : null;
      reticle.visible = !!pose;
      if (pose) reticle.matrix.fromArray(pose.transform.matrix);
      if (!!pose !== wasTracking) { wasTracking = !!pose; on.tracking(wasTracking); }
    }
    renderer.render(scene, camera);
    if (photoReq && frame) {
      const req = photoReq;
      photoReq = null;
      try {
        const shot = grabPhoto(frame);
        shot.toBlob((b) => (b ? req.resolve(new File([b], "room-photo.jpg", { type: "image/jpeg" })) : req.reject(new Error("photo failed"))), "image/jpeg", 0.85);
      } catch (e) {
        req.reject(e);
      }
    }
  });

  /**
   * Inside the XR frame: read the camera image (raw camera access), draw the furniture
   * from the same viewpoint into an offscreen target, and put the two together.
   */
  const photoCam = new THREE.PerspectiveCamera();
  photoCam.matrixAutoUpdate = false;
  photoCam.matrixWorldAutoUpdate = false;
  function grabPhoto(frame: XRFrame): HTMLCanvasElement {
    const ref = renderer.xr.getReferenceSpace();
    const view = ref ? (frame.getViewerPose(ref)?.views[0] as (XRView & { camera?: { width: number; height: number } }) | undefined) : undefined;
    if (!view?.camera) throw new Error("no camera image");
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const binding = (renderer.xr as unknown as { getBinding?: () => XRWebGLBinding }).getBinding?.() ?? new XRWebGLBinding(xrSession, gl);
    const w = view.camera.width, h = view.camera.height;

    // 1. the camera image
    const camTex = (binding as unknown as { getCameraImage(c: unknown): WebGLTexture }).getCameraImage(view.camera);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, camTex, 0);
    const camPx = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, camPx);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    renderer.resetState();

    // 2. the furniture from the same viewpoint (no aim ring)
    photoCam.projectionMatrix.fromArray(view.projectionMatrix);
    photoCam.projectionMatrixInverse.copy(photoCam.projectionMatrix).invert();
    photoCam.matrixWorld.fromArray(view.transform.matrix);
    photoCam.matrixWorldInverse.copy(photoCam.matrixWorld).invert();
    const target = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    const ringWas = reticle.visible;
    reticle.visible = false;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, photoCam);
    const virt = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, virt);
    renderer.setRenderTarget(null);
    renderer.xr.enabled = true;
    reticle.visible = ringWas;
    target.dispose();

    // 3. combine (both images are bottom-up; the furniture is in linear colour)
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const c = out.getContext("2d")!;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4, dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        const a = virt[src + x + 3] / 255;
        for (let k = 0; k < 3; k++) px[dst + x + k] = SRGB[virt[src + x + k]] * a + camPx[src + x + k] * (1 - a);
        px[dst + x + 3] = 255;
      }
    }
    c.putImageData(new ImageData(px, w, h), 0, 0);
    return out;
  }

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    overlay.removeEventListener("beforexrselect", keepTaps);
    hitSource?.cancel();
    renderer.setAnimationLoop(null);
    reticle.geometry.dispose();
    (reticle.material as THREE.Material).dispose();
    renderer.dispose();
    on.ended();
  };
  session.addEventListener("end", cleanup);

  return {
    canPhoto,
    photo() {
      if (!canPhoto) return Promise.reject(new Error("camera access not granted"));
      return new Promise<File>((resolve, reject) => { photoReq = { resolve, reject }; });
    },
    rotate(deg) { model.rotation.y += (deg * Math.PI) / 180; },
    move(right, forward) {
      if (!model.visible) return;
      const cam = renderer.xr.getCamera();
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) return;
      fwd.normalize();
      side.set(-fwd.z, 0, fwd.x); // fwd turned 90° clockwise seen from above = the phone's right
      model.position.addScaledVector(side, right).addScaledVector(fwd, forward);
    },
    end() { session.end().catch(cleanup); },
  };
}
