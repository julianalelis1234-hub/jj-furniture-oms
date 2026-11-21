"use client";

import { AlertTriangle } from "lucide-react";
import dynamic from "next/dynamic";
import { Component, useSyncExternalStore, type ReactNode } from "react";
import { checkPlausibility } from "@/lib/domain/plausibility";
import { FurniturePreview, type PreviewSpec } from "./FurniturePreview";

/** Synchronous WebGL capability check (no canvas is kept). */
export function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    const ok = !!gl;
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

let webglCache: boolean | undefined;
const noopSubscribe = () => () => {};
/** false on the server and during hydration (2D preview), then the real capability. */
function useWebGL(): boolean {
  return useSyncExternalStore(noopSubscribe, () => (webglCache ??= hasWebGL()), () => false);
}

/** true when the viewport is at least `px` wide (false on the server). */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Catches anything thrown while the 3D chunk loads or the <Canvas> initialises. */
class Preview3DBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[3D preview] falling back to the 2D preview:", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Non-blocking feasibility hint; never changes the entered values. */
export function FeasibilityWarning({ spec }: { spec: PreviewSpec }) {
  const r = checkPlausibility(spec);
  if (!r.message) return null;
  return (
    <p role="status" data-testid="feasibility-warning" className="flex gap-2 border-b border-warning/40 bg-warning-soft px-3 py-2 text-xs leading-snug text-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      <span>{r.message}</span>
    </p>
  );
}

/**
 * The configurator's preview: the interactive 3D turntable when WebGL works and
 * all three dimensions are known; otherwise the existing 2D SVG preview (which
 * shows "Dimensions Pending Clarification" for missing W/H/D).
 */
export function FurniturePreviewSlot({ spec, legacyDimensions, footer }: { spec: PreviewSpec; legacyDimensions?: string | null; footer?: ReactNode }) {
  const webgl = useWebGL();
  const complete =
    !!spec.furniture_category && !!spec.design_variant && spec.width_cm != null && spec.height_cm != null && spec.depth_cm != null &&
    spec.width_cm > 0 && spec.height_cm > 0 && spec.depth_cm > 0;
  const fallback = (
    <FurniturePreview spec={spec} legacyDimensions={legacyDimensions} footer={<><FeasibilityWarning spec={spec} />{footer}</>} />
  );
  if (!complete || !webgl) return fallback;
  return (
    <Preview3DBoundary fallback={fallback}>
      <Furniture3D
        spec={{
          furniture_category: spec.furniture_category!,
          design_variant: spec.design_variant!,
          width_cm: spec.width_cm!,
          height_cm: spec.height_cm!,
          depth_cm: spec.depth_cm!,
          wood_type: spec.wood_type,
          color_finish: spec.color_finish,
        }}
        warning={<FeasibilityWarning spec={spec} />}
        footer={footer}
      />
    </Preview3DBoundary>
  );
}

const Furniture3D = dynamic(() => import("./Furniture3DPreview"), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[340/290] items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground" data-testid="preview-3d-loading">
      Loading 3D preview…
    </div>
  ),
});
