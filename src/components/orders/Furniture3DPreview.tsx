"use client";

import { ContactShadows, Edges, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Box, Pause, Play, RotateCcw } from "lucide-react";
import { ArViewer } from "./ar-viewer";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import * as THREE from "three";
import { buildFurnitureParts, type MatKey, type Part } from "@/lib/domain/furniture3d";
import type { FurnitureCategory } from "@/lib/domain/furniture";
import type { WoodType } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export const PREVIEW_3D_DISCLAIMER = "Illustrative 3D Preview — Reference Aid Only (Not a Manufacturing Drawing)";

/** 0.25 rad/s. OrbitControls' autoRotateSpeed 2.0 = one turn per 30 s (2π/30 rad/s). */
const AUTO_ROTATE_SPEED = (0.25 * 30) / Math.PI;
const RESUME_AFTER_MS = 2500;
const BRASS = "#B8864B"; // physical brass hardware (product material, not theme)
/** Theme Caramel #C48A5A: studio rim light, turntable rings and dimension guides. */
const CARAMEL = "#C48A5A";
type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

export interface Furniture3DSpec {
  furniture_category: FurnitureCategory;
  design_variant: string;
  width_cm: number;
  height_cm: number;
  depth_cm: number;
  wood_type: WoodType;
  color_finish: string;
  /** shown instead of "Other" when the customer named the wood */
  wood_label?: string | null;
}

// ---------------------------------------------------------- procedural maps ----
const WOOD_TONES: Record<WoodType, { base: string; dark: string; light: string }> = {
  Mahogany: { base: "#8f4a2a", dark: "#5a2715", light: "#b0673f" }, // warm reddish-brown
  Gmelina: { base: "#d9b57e", dark: "#b88f58", light: "#ecd2a2" }, // light golden-cream
  Other: { base: "#a68664", dark: "#7a5d40", light: "#c2a585" }, // neutral warm timber
};

const textureCache = new Map<string, THREE.CanvasTexture>();

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Canvas wood grain: long wavy fibres, growth rings and a few knots. */
function woodTexture(wood: WoodType): THREE.CanvasTexture {
  const key = `wood:${wood}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const tone = WOOD_TONES[wood];
  g.fillStyle = tone.base;
  g.fillRect(0, 0, size, size);
  const rnd = seeded(wood.length * 7919);
  for (let i = 0; i < 140; i++) {
    const y0 = rnd() * size;
    const amp = 2 + rnd() * 6;
    const freq = 0.004 + rnd() * 0.01;
    g.strokeStyle = rnd() > 0.5 ? tone.dark : tone.light;
    g.globalAlpha = 0.08 + rnd() * 0.22;
    g.lineWidth = 0.6 + rnd() * 2.4;
    g.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const y = y0 + Math.sin(x * freq + i) * amp + Math.sin(x * freq * 3.1) * amp * 0.3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let k = 0; k < 3; k++) {
    const cx = rnd() * size, cy = rnd() * size;
    for (let r = 2; r < 18; r += 3) {
      g.globalAlpha = 0.12;
      g.strokeStyle = tone.dark;
      g.beginPath();
      g.ellipse(cx, cy, r * 2.2, r, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textureCache.set(key, t);
  return t;
}

/** Woven linen for cushions. */
function linenTexture(): THREE.CanvasTexture {
  const hit = textureCache.get("linen");
  if (hit) return hit;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ddd3c2";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 4) {
    g.fillStyle = i % 8 ? "rgba(120,100,80,0.10)" : "rgba(255,255,255,0.18)";
    g.fillRect(i, 0, 2, size);
    g.fillRect(0, i, size, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  textureCache.set("linen", t);
  return t;
}

interface FinishParams { tint: string; roughness: number; clearcoat: number; clearcoatRoughness: number; grain: boolean }
/** Four visibly distinct PBR finishes over the chosen wood. */
/** Descriptive shop finishes ("Warm Espresso Stain", "Mocha Hand-Rubbed Finish" …) render as the nearest of the four PBR looks. */
export function finishFamily(finish: string): string {
  const f = finish.toLowerCase();
  if (f.includes("espresso")) return "Dark Espresso";
  if (f.includes("walnut") || f.includes("mocha") || f.includes("caramel")) return "Walnut Stain";
  if (f.includes("white") || f.includes("gloss")) return "Gloss White";
  return finish;
}

export function finishParams(finish: string): FinishParams {
  switch (finishFamily(finish)) {
    case "Walnut Stain":
      return { tint: "#a8774f", roughness: 0.48, clearcoat: 0.4, clearcoatRoughness: 0.28, grain: true }; // warm walnut-brown stain, grain visible
    case "Gloss White":
      return { tint: "#f5efe4", roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, grain: false }; // high-gloss ivory lacquer
    case "Dark Espresso":
      return { tint: "#2e2019", roughness: 0.86, clearcoat: 0, clearcoatRoughness: 1, grain: true }; // matte near-black stain
    case "Natural Varnish":
    default:
      return { tint: "#ffffff", roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35, grain: true }; // satin clearcoat
  }
}

function useMaterials(wood: WoodType, finish: string): Record<MatKey, THREE.Material> {
  const mats = useMemo(() => {
    const f = finishParams(finish);
    const map = f.grain ? woodTexture(wood) : null;
    const wooden = (shade: number) =>
      new THREE.MeshPhysicalMaterial({
        map,
        color: new THREE.Color(f.tint).multiplyScalar(shade),
        roughness: f.roughness,
        clearcoat: f.clearcoat,
        clearcoatRoughness: f.clearcoatRoughness,
      });
    return {
      wood: wooden(1),
      woodDeep: wooden(f.grain ? 0.8 : 0.93),
      brass: new THREE.MeshStandardMaterial({ color: BRASS, metalness: 0.85, roughness: 0.32 }),
      glass: new THREE.MeshPhysicalMaterial({ color: "#d6e7ec", transparent: true, opacity: 0.32, roughness: 0.08, clearcoat: 1, depthWrite: false }),
      linen: new THREE.MeshStandardMaterial({ map: linenTexture(), color: "#efe7da", roughness: 0.95 }),
    } satisfies Record<MatKey, THREE.Material>;
  }, [wood, finish]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return mats;
}

// ---------------------------------------------------------------- meshes ----
function PartMesh({ part, mats }: { part: Part; mats: Record<MatKey, THREE.Material> }) {
  const edges = (part.mat === "wood" || part.mat === "woodDeep" || part.mat === "glass");
  const rim = edges ? <Edges threshold={25} color={CARAMEL} transparent opacity={0.55} /> : null;
  if (part.shape === "box") {
    const size = part.max.map((v, i) => v - part.min[i]) as [number, number, number];
    const pos = part.max.map((v, i) => (v + part.min[i]) / 2) as [number, number, number];
    return (
      <mesh position={pos} material={mats[part.mat]} castShadow receiveShadow>
        <boxGeometry args={size} />
        {rim}
      </mesh>
    );
  }
  if (part.shape === "cyl") {
    return (
      <mesh position={[part.base[0], part.base[1] + part.h / 2, part.base[2]]} scale={[part.sx ?? 1, 1, part.sz ?? 1]} material={mats[part.mat]} castShadow>
        <cylinderGeometry args={[part.rTop, part.rBottom, part.h, 40]} />
        {rim}
      </mesh>
    );
  }
  // cylinder along z; `half` keeps the upper half (arch tops, rounded arms)
  return (
    <mesh position={part.center} rotation={[Math.PI / 2, 0, 0]} material={mats[part.mat]} castShadow>
      <cylinderGeometry args={[part.r, part.r, part.len, 40, 1, false, part.half ? -Math.PI / 2 : 0, part.half ? Math.PI : Math.PI * 2]} />
      {rim}
    </mesh>
  );
}

/** Faint concentric showroom turntable rings in warm brass. */
function Turntable({ radius }: { radius: number }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
      <mesh>
        <circleGeometry args={[radius * 1.18, 64]} />
        <meshBasicMaterial color={CARAMEL} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      {[1, 1.09, 1.18].map((k, i) => (
        <mesh key={k}>
          <ringGeometry args={[radius * k - 0.004, radius * k, 96]} />
          <meshBasicMaterial color={CARAMEL} transparent opacity={0.45 - i * 0.12} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Everything turns around the turntable centre, so frame the full turning
 * radius: furniture corners and the W / H / D labels.
 */
export function sceneFrame(spec: Furniture3DSpec) {
  const { W, H, D, radius, off } = labelAnchors(spec);
  const labelReach = Math.hypot(W / 2 + off * 1.8, D / 2 + off * 1.8) + 0.25;
  const reach = Math.max(labelReach, radius * 1.18);
  const sceneH = Math.max(H, 0.6);
  return { centerX: 0, sceneW: reach * 2, sceneH, depth: D };
}

export function labelAnchors(spec: Furniture3DSpec) {
  const W = spec.width_cm / 100, H = spec.height_cm / 100, D = spec.depth_cm / 100;
  const radius = Math.max(Math.hypot(W, D) / 2, 0.25);
  const off = Math.max(0.05, Math.min(W, H, D) * 0.08 + 0.04);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return {
    W, H, D, radius, off,
    labels: [
      { id: "w", text: `W ${fmt(spec.width_cm)} cm`, pos: [0, 0.003, D / 2 + off * 1.8] as const },
      { id: "h", text: `H ${fmt(spec.height_cm)} cm`, pos: [W / 2 + off * 1.8, H / 2, D / 2] as const },
      { id: "d", text: `D ${fmt(spec.depth_cm)} cm`, pos: [W / 2 + off * 1.8, 0.003, 0] as const },
    ],
  };
}

/** Imperative DOM write, done every frame without React re-renders. */
function placeLabel(el: HTMLElement, x: number, y: number, visible: boolean) {
  el.style.opacity = visible ? "1" : "0";
  el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
}

/**
 * Projects the label anchors to screen space every frame and moves plain DOM
 * spans rendered OUTSIDE the <Canvas> (React owns them; nothing is portalled
 * into the canvas container, so unmounting is always clean).
 */
function LabelProjector({ anchors, els }: { anchors: ReturnType<typeof labelAnchors>["labels"]; els: React.RefObject<Record<string, HTMLSpanElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of anchors) {
      const el = els.current?.[a.id];
      if (!el) continue;
      v.set(a.pos[0], a.pos[1], a.pos[2]).project(camera);
      placeLabel(el, ((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height, v.z < 1);
    }
  });
  return null;
}

function Scene({ spec, autoRotate, onStart, onEnd, controlsRef, labelEls, furnitureRef }: {
  spec: Furniture3DSpec; autoRotate: boolean; onStart: () => void; onEnd: () => void; controlsRef: React.RefObject<OrbitControlsImpl | null>;
  labelEls: React.RefObject<Record<string, HTMLSpanElement | null>>;
  /** the furniture group alone (what AR places in the room) */
  furnitureRef?: React.RefObject<THREE.Group | null>;
}) {
  const mats = useMaterials(spec.wood_type, spec.color_finish);
  const parts = useMemo(
    () => buildFurnitureParts(spec.furniture_category, spec.design_variant, { w: spec.width_cm, h: spec.height_cm, d: spec.depth_cm }),
    [spec.furniture_category, spec.design_variant, spec.width_cm, spec.height_cm, spec.depth_cm],
  );
  const { W, H, D, radius, off, labels } = labelAnchors(spec);
  const frame = sceneFrame(spec);
  return (
    <>
      <hemisphereLight args={["#FAF6F0", "#6B4A3A", 0.9]} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 3, -2]} intensity={0.5} color="#E7D6C1" />
      <Turntable radius={radius} />
      {/* the furniture alone: exact W × H × D (1 unit = 100 cm) */}
      {/* keyed by design + size: edge outlines are rebuilt for the new geometry instead of lingering */}
      <group key={`${spec.furniture_category}|${spec.design_variant}|${spec.width_cm}|${spec.height_cm}|${spec.depth_cm}`} scale={0.01} name="furniture" ref={furnitureRef}>
        {parts.map((p, i) => <PartMesh key={i} part={p} mats={mats} />)}
      </group>
      {/* W × H × D dimension lines with the entered values */}
      <Line points={[[-W / 2, 0.003, D / 2 + off], [W / 2, 0.003, D / 2 + off]]} color={CARAMEL} lineWidth={1.2} />
      <Line points={[[W / 2 + off, 0, D / 2], [W / 2 + off, H, D / 2]]} color={CARAMEL} lineWidth={1.2} />
      <Line points={[[W / 2 + off, 0.003, -D / 2], [W / 2 + off, 0.003, D / 2]]} color={CARAMEL} lineWidth={1.2} />
      <LabelProjector anchors={labels} els={labelEls} />
      <ContactShadows position={[0, 0.001, 0]} scale={radius * 3} blur={2.4} opacity={0.35} far={H + 0.2} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[frame.centerX, frame.sceneH * 0.42, 0]}
        enableZoom
        enablePan={false}
        enableDamping
        dampingFactor={0.15}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2 - 0.06} // stay above the floor
        minDistance={0.6}
        maxDistance={Math.max(W, H, D, 1) * 6}
        autoRotate={autoRotate}
        autoRotateSpeed={AUTO_ROTATE_SPEED}
        onStart={onStart}
        onEnd={onEnd}
      />
    </>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Interactive 3D showroom turntable. Load only through FurniturePreviewSlot
 * (next/dynamic, ssr:false, WebGL check + error boundary with 2D fallback).
 */
export default function Furniture3DPreview({ spec, className, footer, warning, compact = false, ar = false, expanded = false, furnitureRef }: {
  spec: Furniture3DSpec; className?: string; footer?: ReactNode; warning?: ReactNode;
  /** pinned mobile view: a shorter stage, one-line disclaimer, no footer */
  compact?: boolean;
  /** customer designer only: the bottom-left AR button opens the full-screen view with "View in your room" */
  ar?: boolean;
  /** inside the full-screen AR view: the stage fills the height */
  expanded?: boolean;
  furnitureRef?: React.RefObject<THREE.Group | null>;
}) {
  const [arOpen, setArOpen] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const [spinOn, setSpinOn] = useState(!reduced); // reduced motion: no auto-spin, manual orbit still works
  const [dragging, setDragging] = useState(false);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const labelEls = useRef<Record<string, HTMLSpanElement | null>>({});
  useEffect(() => () => { if (resume.current) clearTimeout(resume.current); }, []);

  const W = spec.width_cm / 100, H = spec.height_cm / 100, D = spec.depth_cm / 100;
  const radius = Math.max(Math.hypot(W, D) / 2, 0.25);
  const { centerX, sceneW, sceneH, depth } = sceneFrame(spec);
  // fit the whole scene (fov 32°, ~1.36 aspect) with a margin that survives a full turn
  const dist = Math.max(sceneW * 1.55, sceneH * 2.05, depth * 1.4) + 0.3;
  const camPos = useMemo<[number, number, number]>(() => [centerX + dist * 0.5, sceneH * 0.7 + dist * 0.17, dist * 0.86], [centerX, dist, sceneH]);

  const reset = () => {
    const c = controls.current;
    if (!c) return;
    c.object.position.set(...camPos);
    c.update();
  };

  return (
    <figure className={cn("jj-surface overflow-hidden rounded-2xl border border-live bg-secondary", expanded && "flex min-h-0 flex-col", className)} aria-label="Interactive 3D furniture preview" data-testid="preview-3d">
      {compact
        ? <figcaption className="sr-only">{PREVIEW_3D_DISCLAIMER}</figcaption>
        : <figcaption className="border-b border-live/40 bg-background/70 px-3 py-2 text-[0.7rem] leading-snug font-semibold text-muted-foreground">{PREVIEW_3D_DISCLAIMER}</figcaption>}
      {!compact && warning}
      <div className={cn("relative w-full touch-none", expanded ? "min-h-0 flex-1" : compact ? "aspect-[16/9] max-h-[24svh]" : "aspect-[340/250]")} data-compact={compact || undefined}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,var(--background)_0%,var(--secondary)_75%)]">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ fov: 32, position: camPos, near: 0.05, far: 200 }}
          gl={{ antialias: true, preserveDrawingBuffer: false }}
          aria-label={`${spec.design_variant} ${spec.furniture_category}, ${spec.width_cm} by ${spec.height_cm} by ${spec.depth_cm} centimetres, ${spec.wood_type}, ${spec.color_finish}`}
        >
          <Scene
            spec={spec}
            labelEls={labelEls}
            controlsRef={controls}
            furnitureRef={furnitureRef}
            autoRotate={spinOn && !dragging}
            onStart={() => { if (resume.current) clearTimeout(resume.current); setDragging(true); }}
            onEnd={() => { resume.current = setTimeout(() => setDragging(false), RESUME_AFTER_MS); }}
          />
        </Canvas>
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {labelAnchors(spec).labels.map((l) => (
            <span
              key={l.id}
              ref={(el) => { labelEls.current[l.id] = el; }}
              data-testid={`dim-${l.id}`}
              className="absolute top-0 left-0 rounded border border-live bg-background/90 px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-foreground tabular-nums opacity-0 shadow-sm"
            >
              {l.text}
            </span>
          ))}
        </div>
        <span className="pointer-events-none absolute top-2 left-2 rounded-full border border-live bg-background/90 px-2.5 py-0.5 text-[0.7rem] font-bold">
          {spec.wood_label || spec.wood_type} <span className="font-normal text-muted-foreground">· {spec.color_finish}</span>
        </span>
        {ar && !expanded && (
          <button type="button" onClick={() => setArOpen(true)} data-testid="ar-open" aria-haspopup="dialog"
            aria-label="Open full screen and view it in your room (AR)"
            className="absolute bottom-2 left-2 flex h-9 items-center gap-1.5 rounded-full border border-live bg-background/95 pr-3 pl-2 text-xs font-bold text-primary shadow-sm hover:bg-accent-soft focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
            <Box className="size-4" aria-hidden /> AR
          </button>
        )}
      </div>
      </div>
      <div className={cn("flex flex-wrap items-center gap-1.5 border-t border-live/40 bg-background/70 px-2", compact ? "py-1" : "py-1.5")}>
        <button type="button" onClick={() => setSpinOn((s) => !s)} aria-pressed={spinOn} data-testid="spin-toggle"
          className="flex h-9 items-center gap-1 rounded-full border border-primary/50 bg-background px-3 text-xs font-semibold text-primary hover:border-primary hover:bg-accent-soft">
          {spinOn ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {spinOn ? "Pause Spin" : "3D Spin"}
        </button>
        <button type="button" onClick={reset} className="flex h-9 items-center gap-1 rounded-full border border-primary/50 bg-background px-3 text-xs font-semibold text-primary hover:border-primary hover:bg-accent-soft">
          <RotateCcw className="size-3.5" aria-hidden /> Reset View
        </button>
        <span className="ml-auto text-[0.7rem] text-muted-foreground">{compact ? "Illustrative preview only" : "Drag to turn · pinch / scroll to zoom"}</span>
      </div>
      {!compact && footer}
      {arOpen && <ArViewer spec={spec} onClose={() => setArOpen(false)} />}
    </figure>
  );
}
