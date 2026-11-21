import { cn } from "@/lib/utils";

/**
 * Minimal stylised Mahogany/Gmelina tree for the hero. Inline SVG + pure CSS
 * keyframes (see .jj-tree-* in globals.css): three foliage canopies sway on
 * staggered 4.5s–6.5s loops between -2.5deg and +2.5deg around their base,
 * and two leaves drift down. Colours follow the theme tokens; motion stops
 * entirely under prefers-reduced-motion. Decorative only (aria-hidden).
 */
export function SwayingTree({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 140"
      className={cn("jj-tree h-28 w-24 shrink-0 sm:h-32 sm:w-28", className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* ground line */}
      <path d="M18 134 H102" className="jj-tree-ground" strokeWidth="1.5" strokeLinecap="round" />
      {/* trunk with two branch stubs */}
      <path
        className="jj-tree-trunk"
        d="M56 134 C57 118 56 104 54 92 C51 84 46 80 42 76 L45 74 C50 78 54 82 57 86 C58 78 58 70 57 62 L63 62 C62 72 62 80 63 86 C66 81 71 77 76 74 L78 76 C73 80 68 85 66 92 C64 104 63 118 64 134 Z"
      />
      {/* canopies: back, middle, front (each sways from its own base) */}
      <g className="jj-tree-canopy jj-tree-canopy-1">
        <ellipse cx="60" cy="44" rx="40" ry="30" className="jj-tree-leaf-3" />
      </g>
      <g className="jj-tree-canopy jj-tree-canopy-2">
        <ellipse cx="44" cy="58" rx="26" ry="19" className="jj-tree-leaf-2" />
        <ellipse cx="78" cy="56" rx="27" ry="20" className="jj-tree-leaf-2" />
      </g>
      <g className="jj-tree-canopy jj-tree-canopy-3">
        <ellipse cx="60" cy="36" rx="25" ry="19" className="jj-tree-leaf-1" />
        <path d="M60 20 C61 28 61 36 60 46" className="jj-tree-vein" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
      {/* two drifting leaves */}
      <path className="jj-tree-drift jj-tree-drift-1" d="M88 70 c4 -3 9 -2 10 2 c-4 3 -9 2 -10 -2 z" />
      <path className="jj-tree-drift jj-tree-drift-2" d="M30 66 c3 -3 8 -3 9 1 c-3 3 -8 3 -9 -1 z" />
    </svg>
  );
}
