"use client";

import * as THREE from "three";

/**
 * "Joystick camera view" for phones without WebXR (iPhone Safari): the rear
 * camera fills the screen and the furniture is drawn over it on a virtual
 * floor. The phone's tilt and turn (device orientation) move the virtual
 * camera so the piece roughly stays where it was put, but nothing is tracked:
 * the size is approximate. The customer moves it with the joystick and can
 * take a photo (camera image + furniture) for the order.
 *
 * Nothing leaves the phone unless the customer adds the photo to the order.
 */
const EYE_HEIGHT = 1.35; // metres: a phone held at chest height
const MIN_DISTANCE = 2.4; // metres in front of the customer (further for tall or wide pieces)
const D2R = Math.PI / 180;

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** Must be called inside the tap (iOS asks for motion access only from a tap). */
export function askMotionPermission(): Promise<boolean> {
  const D = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null) as unknown as OrientationPermission | null;
  if (!D?.requestPermission) return Promise.resolve(true);
  return D.requestPermission().then((r) => r === "granted").catch(() => false);
}

export interface CameraViewHandle {
  move(right: number, forward: number): void;
  rotate(deg: number): void;
  /** camera image + furniture as a JPEG */
  photo(): Promise<File>;
  end(): void;
}

export async function startCameraView(model: THREE.Object3D, host: HTMLElement, video: HTMLVideoElement, motion: boolean): Promise<CameraViewHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;touch-action:none";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a7563", 2.4));
  const sun = new THREE.DirectionalLight("#ffffff", 1.3);
  sun.position.set(1, 3, 2);
  scene.add(sun);

  // a soft contact shadow so the piece looks grounded
  const sc = document.createElement("canvas");
  sc.width = sc.height = 128;
  const g = sc.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const shadowTex = new THREE.CanvasTexture(sc);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.35 + 0.2, size.z * 1.35 + 0.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.position.y = 0.002;

  const piece = new THREE.Group();
  piece.add(shadow, model);
  piece.position.set(0, 0, -Math.max(MIN_DISTANCE, size.y * 1.7, size.x * 1.3));
  scene.add(piece);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 50);
  camera.rotation.order = "YXZ";
  camera.position.set(0, EYE_HEIGHT, 0);

  // device orientation → yaw / pitch (portrait), smoothed; without motion the view looks slightly down
  let yaw0: number | null = null;
  const target = { yaw: 0, pitch: -22 * D2R };
  const onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.alpha == null) return;
    if (yaw0 == null) yaw0 = e.alpha;
    target.pitch = THREE.MathUtils.clamp((e.beta - 90) * D2R, -80 * D2R, 30 * D2R);
    let d = e.alpha - yaw0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    target.yaw = d * D2R;
  };
  if (motion) window.addEventListener("deviceorientation", onOrient);

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // portrait phone cameras show about 63° vertically; landscape about 48°
    camera.fov = w < h ? 63 : 48;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  renderer.setAnimationLoop(() => {
    camera.rotation.y += (target.yaw - camera.rotation.y) * 0.2;
    camera.rotation.x += (target.pitch - camera.rotation.x) * 0.2;
    renderer.render(scene, camera);
  });

  const fwd = new THREE.Vector3();
  return {
    move(right, forward) {
      // relative to where the phone points, flat on the floor
      fwd.set(-Math.sin(camera.rotation.y), 0, -Math.cos(camera.rotation.y));
      piece.position.x += fwd.x * forward - fwd.z * right;
      piece.position.z += fwd.z * forward + fwd.x * right;
    },
    rotate(deg) { piece.rotation.y += deg * D2R; },
    async photo() {
      const w = canvas.width, h = canvas.height;
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const c = out.getContext("2d")!;
      // the video is shown "cover": crop it the same way
      const vw = video.videoWidth, vh = video.videoHeight;
      const k = Math.max(w / vw, h / vh);
      c.drawImage(video, (w - vw * k) / 2, (h - vh * k) / 2, vw * k, vh * k);
      c.drawImage(canvas, 0, 0);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", 0.85));
      if (!blob) throw new Error("photo failed");
      return new File([blob], "room-photo.jpg", { type: "image/jpeg" });
    },
    end() {
      renderer.setAnimationLoop(null);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("resize", resize);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      shadowTex.dispose();
      canvas.remove();
      renderer.dispose();
    },
  };
}
