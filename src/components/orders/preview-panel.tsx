"use client";

import type { FurnitureSpec } from "@/lib/domain/furniture";
import { FurniturePreview } from "./FurniturePreview";

/** Read-only preview for server pages (order detail, slip). */
export function PreviewPanel({ spec, legacyDimensions, compact }: { spec: FurnitureSpec; legacyDimensions?: string | null; compact?: boolean }) {
  return <FurniturePreview spec={spec} legacyDimensions={legacyDimensions} compact={compact} />;
}
