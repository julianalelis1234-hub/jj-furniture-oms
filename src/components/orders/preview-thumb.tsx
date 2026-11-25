"use client";

import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FurniturePreview, type PreviewSpec } from "./FurniturePreview";
import { FurniturePreviewSlot } from "./preview-slot";

/**
 * A small preview beside the job details. Tapping it opens the full view: the
 * 3D model (turn and zoom) or, without WebGL, the large drawing with all sizes.
 */
export function PreviewThumb({ spec, title, legacyDimensions, className }: {
  spec: PreviewSpec; title: string; legacyDimensions?: string | null; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="preview-thumb"
        aria-label={`Enlarge the picture of ${title}`}
        className={`group relative block w-32 shrink-0 overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:w-40 ${className ?? ""}`}>
        {/* the drawing only: labels and chips are too small to read at this size */}
        <span className="pointer-events-none block [&_figcaption]:hidden [&_[data-wood-chip]]:hidden [&_figure]:border-0 [&_figure]:shadow-none [&_p]:hidden" aria-hidden>
          <FurniturePreview compact spec={spec} legacyDimensions={legacyDimensions} />
        </span>
        <span className="flex items-center justify-center gap-1 border-t border-border bg-muted/60 px-2 py-1 text-[11px] font-semibold text-primary">
          <Maximize2 className="size-3" aria-hidden /> Tap to enlarge
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-4xl" data-testid="preview-enlarged">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Drag to turn, pinch or scroll to zoom. Sizes are shown on the model.</DialogDescription>
          </DialogHeader>
          {open && <FurniturePreviewSlot spec={spec} legacyDimensions={legacyDimensions} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
