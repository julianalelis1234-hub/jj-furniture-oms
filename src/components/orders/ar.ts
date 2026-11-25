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
 *    place, rotate. The camera image is never readable by the page.
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
export async function openQuickLook(model: THREE.Object3D, name: string) {
  const exporter = new USDZExporter();
  const scene = new THREE.Scene();
  scene.add(model);
  const usdz = await exporter.parseAsync(scene, {
    quickLookCompatible: true,
    ar: { anchoring: { type: "plane" }, planeAnchoring: { alignment: "horizontal" } },
  });
  const url = URL.createObjectURL(new Blob([usdz as BlobPart], { type: "model/vnd.usdz+zip" }));
  const a = document.createElement("a");
  a.rel = "ar";
  a.download = `${name.replace(/[^A-Za-z0-9-]+/g, "-")}.usdz`;
  // true size: the customer cannot pinch it bigger or smaller by accident
  a.href = `${url}#allowsContentScaling=0`;
  a.appendChild(document.createElement("img")); // Quick Look needs an <img> child
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ----------------------------------------------------------------- Android ----
interface XRSessionLike extends EventTarget {
  end(): Promise<void>;
  requestReferenceSpace(type: string): Promise<unknown>;
  requestHitTestSource?(o: { space: unknown }): Promise<{ cancel(): void }> | undefined;
}

export interface WebXrHandle {
  rotate(deg: number): void;
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
    optionalFeatures: ["dom-overlay", "light-estimation"],
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

  let wasTracking = false;
  const camPos = new THREE.Vector3();
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
  });

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
    rotate(deg) { model.rotation.y += (deg * Math.PI) / 180; },
    end() { session.end().catch(cleanup); },
  };
}
