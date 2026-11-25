"use client";

import type { FurnitureSpec } from "@/lib/domain/furniture";
import { FurniturePreviewSlot } from "./preview-slot";

/**
 * Read-only preview for server pages (order detail, slip): the same 3D model the
 * customer designed (2D drawing when the device has no WebGL).
 */
export function PreviewPanel({ spec, legacyDimensions, compact }: { spec: FurnitureSpec; legacyDimensions?: string | null; compact?: boolean }) {
  return (
    <FurniturePreviewSlot
      compact={compact}
      legacyDimensions={legacyDimensions}
      spec={{
        furniture_category: spec.furniture_category,
        design_variant: spec.design_variant,
        width_cm: spec.width_cm,
        height_cm: spec.height_cm,
        depth_cm: spec.depth_cm,
        wood_type: spec.wood_type,
        color_finish: spec.color_finish,
        wood_label: spec.wood_type === "Other" ? spec.custom_wood_note : null,
      }}
    />
  );
}
