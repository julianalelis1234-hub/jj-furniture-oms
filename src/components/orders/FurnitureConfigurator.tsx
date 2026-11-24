"use client";

import { ChevronDown, ChevronUp, DoorOpen, Lock, Package, Sofa, Table2, Warehouse } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CATALOG,
  FINISHES,
  FURNITURE_CATEGORIES,
  WOOD_INFO,
  formatDims,
  type FurnitureCategory,
  type FurnitureSpec,
} from "@/lib/domain/furniture";
import { WOOD_TYPES, type WoodType } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { finishLook, type PreviewSpec } from "./FurniturePreview";
import { FeasibilityWarning, FurniturePreviewSlot, useMinWidth } from "./preview-slot";

/** Form state (inputs keep strings so people can type freely). */
export interface ConfigValue {
  furniture_category: FurnitureCategory | "";
  design_variant: string;
  width_cm: string;
  height_cm: string;
  depth_cm: string;
  wood_type: WoodType;
  custom_wood_note: string;
  color_finish: string;
  quantity: string;
}

export function emptyConfig(): ConfigValue {
  return {
    furniture_category: "Dining Table",
    design_variant: "6-Seater Classic",
    width_cm: "180",
    height_cm: "76",
    depth_cm: "90",
    wood_type: "Mahogany",
    custom_wood_note: "",
    color_finish: "Natural Varnish",
    quantity: "1",
  };
}

export function configFromSpec(s: FurnitureSpec): ConfigValue {
  return {
    furniture_category: s.furniture_category ?? "",
    design_variant: s.design_variant ?? "",
    width_cm: s.width_cm == null ? "" : String(s.width_cm),
    height_cm: s.height_cm == null ? "" : String(s.height_cm),
    depth_cm: s.depth_cm == null ? "" : String(s.depth_cm),
    wood_type: s.wood_type,
    custom_wood_note: s.custom_wood_note ?? "",
    color_finish: s.color_finish,
    quantity: String(s.quantity ?? 1),
  };
}

const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) || Number(v) <= 0 ? null : Number(v));

export function configToPreview(v: ConfigValue): PreviewSpec {
  return {
    furniture_category: v.furniture_category || null,
    design_variant: v.design_variant || null,
    width_cm: num(v.width_cm),
    height_cm: num(v.height_cm),
    depth_cm: num(v.depth_cm),
    wood_type: v.wood_type,
    color_finish: v.color_finish,
  };
}

/** Comparable spec (numbers, trimmed) for change detection against a revision. */
export function configToSpec(v: ConfigValue): FurnitureSpec {
  return {
    furniture_category: v.furniture_category || null,
    design_variant: v.design_variant || null,
    width_cm: num(v.width_cm),
    height_cm: num(v.height_cm),
    depth_cm: num(v.depth_cm),
    wood_type: v.wood_type,
    custom_wood_note: v.wood_type === "Other" ? v.custom_wood_note.trim() || null : null,
    color_finish: v.color_finish,
    quantity: Number(v.quantity) || 1,
  };
}

const CAT_ICON: Record<FurnitureCategory, ReactNode> = {
  "Panel Door": <DoorOpen />,
  "Dining Table": <Table2 />,
  "Living Room Set": <Sofa />,
  "Kitchen / Wall Cabinet": <Warehouse />,
  "Custom Piece": <Package />,
};
const WOOD_SWATCH: Record<WoodType, string> = { Mahogany: "#8a4a2b", Gmelina: "#d9b57e", Other: "#a68664" };

function Chip({
  name,
  value,
  checked,
  onSelect,
  disabled,
  children,
  className,
  testId,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <label
      data-testid={testId}
      className={cn(
        "relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors",
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
        checked ? "border-primary bg-primary/[0.06] text-foreground ring-1 ring-primary" : "hover:border-primary/50",
        disabled && "cursor-not-allowed opacity-70",
        className,
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} disabled={disabled} className="sr-only" />
      {children}
    </label>
  );
}

function Group({ legend, step, children, error }: { legend: string; step: number; children: ReactNode; error?: string }) {
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-2">
      <legend className="mb-1 flex items-center gap-2 text-sm font-bold">
        <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs tabular-nums">{step}</span>
        {legend}
      </legend>
      {children}
      {error && <p className="text-sm font-medium text-destructive" role="alert">{error}</p>}
    </fieldset>
  );
}

/**
 * Shared real-time furniture configurator (staff intake + customer portal).
 * Structured fields are submitted with the surrounding <form> through their
 * native input names; the preview is illustrative only.
 */
export function FurnitureConfigurator({
  value,
  onChange,
  errors = {},
  readOnly = false,
  showQuantity = false,
  lockedLabel,
  previewFooter,
  legacyDimensions,
  inDialog = false,
}: {
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  errors?: Record<string, string>;
  readOnly?: boolean;
  showQuantity?: boolean;
  lockedLabel?: string;
  previewFooter?: ReactNode;
  legacyDimensions?: string | null;
  /** inside a scrolling dialog: stick to the dialog top, leave page scroll padding alone */
  inDialog?: boolean;
}) {
  const set = (patch: Partial<ConfigValue>) => onChange({ ...value, ...patch });
  const cat = value.furniture_category ? CATALOG[value.furniture_category] : null;
  const preview = configToPreview(value);
  const dims = formatDims(preview);
  // mobile: the 3D view is pinned under the summary bar by default, so every choice shows at once
  const [open, setOpen] = useState(!inDialog && !readOnly);
  const barRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);

  // Mobile: keep the compact bar under the sticky app header and reserve
  // scroll padding so focused fields never hide underneath it.
  useEffect(() => {
    if (inDialog) return;
    const header = document.querySelector("header.sticky") as HTMLElement | null;
    const update = () => {
      const hh = header?.offsetHeight ?? 0;
      setTop(hh);
      const mobile = window.matchMedia("(max-width: 1023.98px)").matches;
      document.documentElement.style.scrollPaddingTop = `${hh + (mobile ? (barRef.current?.offsetHeight ?? 64) : 0) + 12}px`;
    };
    update();
    const ro = new ResizeObserver(update);
    if (header) ro.observe(header);
    if (barRef.current) ro.observe(barRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.scrollPaddingTop = "";
    };
  }, [inDialog]);

  const summary = [value.design_variant || "Choose a design", dims, value.wood_type, value.color_finish].filter(Boolean).join(" · ");
  const look = finishLook(value.wood_type, value.color_finish);
  const pick = (c: FurnitureCategory) => {
    const def = CATALOG[c];
    const p = def.presets[0];
    set({
      furniture_category: c,
      design_variant: def.variants[0],
      ...(p ? { width_cm: String(p.width_cm), height_cm: String(p.height_cm), depth_cm: String(p.depth_cm) } : {}),
    });
  };
  const presetActive = (p: { width_cm: number; height_cm: number; depth_cm: number }) =>
    num(value.width_cm) === p.width_cm && num(value.height_cm) === p.height_cm && num(value.depth_cm) === p.depth_cm;
  const isCustomSize = !cat?.presets.some(presetActive);

  // one preview instance at a time (one WebGL context): desktop sticky card OR the mobile expandable panel
  const isDesktop = useMinWidth(1024);
  const previewCard = (
    <FurniturePreviewSlot spec={preview} legacyDimensions={legacyDimensions} footer={previewFooter} />
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
      {/* ---------------------------------------------- mobile compact bar */}
      <div ref={barRef} style={{ top }} className="sticky z-20 -mx-4 min-w-0 border-y bg-card/95 backdrop-blur sm:mx-0 sm:rounded-xl sm:border lg:hidden" data-testid="configurator-pin">
        <div className="flex items-center gap-3 px-4 py-2 sm:px-3" data-testid="configurator-bar">
          <span
            className="size-10 shrink-0 rounded-md border"
            style={{ background: look.surface, transition: "background 200ms ease-out" }}
            aria-hidden
          />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums">{summary}</p>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex h-10 items-center gap-1 rounded-lg border px-3 text-sm font-semibold"
          >
            {open ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
            {open ? "Hide 3D" : "Show 3D"}
          </button>
        </div>
        {/* pinned 3D view: part of the sticky block, so scroll padding keeps focused inputs below it */}
        {open && !isDesktop && <div className="px-2 pb-2" data-testid="pinned-preview"><FurniturePreviewSlot spec={preview} legacyDimensions={legacyDimensions} compact /></div>}
      </div>
      {/* the size hint is too tall for the pinned view: on phones it sits in the page instead */}
      {!isDesktop && <div className="-mt-2 lg:hidden"><FeasibilityWarning spec={preview} /></div>}

      {/* --------------------------------------------------------- controls */}
      <div className="grid min-w-0 grid-cols-1 gap-5">
        {readOnly && (
          <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success-soft p-3 text-sm font-semibold text-success">
            <Lock className="size-4" aria-hidden /> {lockedLabel ?? "Locked for production — the specification can no longer change"}
          </p>
        )}

        <Group legend="Furniture category" step={1} error={errors.furniture_category}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FURNITURE_CATEGORIES.map((c) => (
              <Chip key={c} name="furniture_category" value={c} checked={value.furniture_category === c} onSelect={() => pick(c)} disabled={readOnly}
                className="flex-col items-start gap-1 py-3 [&_svg]:size-5 [&_svg]:text-primary" testId={`cat-${c}`}>
                {CAT_ICON[c]}
                <span className="leading-tight font-semibold">{c}</span>
                <span className="text-xs font-normal text-muted-foreground">{CATALOG[c].blurb}</span>
              </Chip>
            ))}
          </div>
        </Group>

        <Group legend="Design" step={2} error={errors.design_variant}>
          {cat ? (
            <div className="flex flex-wrap gap-2">
              {cat.variants.map((v) => (
                <Chip key={v} name="design_variant" value={v} checked={value.design_variant === v} onSelect={() => set({ design_variant: v })} disabled={readOnly}>
                  {v}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Choose a category first.</p>
          )}
        </Group>

        <Group legend="Size (W × H × D)" step={3} error={errors.width_cm || errors.height_cm || errors.depth_cm}>
          {cat && cat.presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {cat.presets.map((p) => (
                <button
                  key={`${p.width_cm}-${p.height_cm}-${p.depth_cm}`}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={presetActive(p)}
                  onClick={() => set({ width_cm: String(p.width_cm), height_cm: String(p.height_cm), depth_cm: String(p.depth_cm) })}
                  className={cn("min-h-11 rounded-lg border px-3 text-sm font-semibold tabular-nums", presetActive(p) ? "border-primary bg-primary/[0.06] ring-1 ring-primary" : "bg-card hover:border-primary/50", readOnly && "opacity-70")}
                >
                  {formatDims(p)}
                </button>
              ))}
              <span className={cn("flex min-h-11 items-center rounded-lg border border-dashed px-3 text-sm", isCustomSize ? "border-primary font-semibold text-primary" : "text-muted-foreground")}>
                Custom
              </span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {(["width_cm", "height_cm", "depth_cm"] as const).map((k) => (
              <label key={k} className="grid gap-1 text-xs font-semibold">
                {k === "width_cm" ? "Width" : k === "height_cm" ? "Height" : "Depth"} (cm)
                <input
                  name={k}
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="1000"
                  step="0.1"
                  value={value[k]}
                  disabled={readOnly}
                  aria-invalid={!!errors[k] || undefined}
                  onChange={(e) => set({ [k]: e.target.value } as Partial<ConfigValue>)}
                  className="h-11 w-full rounded-lg border border-input bg-card px-3 text-base font-semibold tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive disabled:opacity-70"
                />
              </label>
            ))}
          </div>
        </Group>

        {!isDesktop && (
          <div className="overflow-hidden rounded-lg border empty:hidden">
            <FeasibilityWarning spec={preview} />
          </div>
        )}

        <Group legend="Wood" step={4} error={errors.wood_type || errors.custom_wood_note}>
          <div className="grid grid-cols-3 gap-2">
            {WOOD_TYPES.map((w) => (
              <Chip key={w} name="wood_type" value={w} checked={value.wood_type === w} onSelect={() => set({ wood_type: w })} disabled={readOnly}
                className="flex-col items-start gap-1 py-2.5" testId={`wood-${w}`}>
                <span className="h-5 w-full rounded border" style={{ background: `repeating-linear-gradient(172deg, ${WOOD_SWATCH[w]} 0 5px, color-mix(in oklab, ${WOOD_SWATCH[w]} 82%, black) 5px 6px)` }} aria-hidden />
                <span className="font-semibold">{WOOD_INFO[w].label}</span>
                <span className="text-xs font-normal text-muted-foreground">{WOOD_INFO[w].note}</span>
              </Chip>
            ))}
          </div>
          {value.wood_type === "Other" && (
            <label className="grid gap-1 text-sm font-semibold">
              Describe the wood <span className="sr-only">(required)</span>
              <input
                name="custom_wood_note"
                value={value.custom_wood_note}
                disabled={readOnly}
                required
                maxLength={120}
                placeholder="e.g. Narra from the customer's own lumber"
                aria-invalid={!!errors.custom_wood_note || undefined}
                onChange={(e) => set({ custom_wood_note: e.target.value })}
                className="h-11 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive"
              />
            </label>
          )}
        </Group>

        <Group legend="Color / finish" step={5} error={errors.color_finish}>
          <div className="grid grid-cols-2 gap-2">
            {/* a finish written on an older order (not one of the four) stays selectable, so re-quoting never changes it silently */}
            {[...FINISHES, ...((FINISHES as readonly string[]).includes(value.color_finish) || !value.color_finish ? [] : [value.color_finish])].map((f) => {
              const l = finishLook(value.wood_type, f);
              return (
                <Chip key={f} name="color_finish" value={f} checked={value.color_finish === f} onSelect={() => set({ color_finish: f })} disabled={readOnly} testId={`finish-${f}`}>
                  <span
                    className="size-7 shrink-0 rounded-md border"
                    style={{ background: `linear-gradient(135deg, ${l.sheen}${Math.round(l.sheenOpacity * 255).toString(16).padStart(2, "0")} 0%, transparent 45%), ${l.surface}` }}
                    aria-hidden
                  />
                  {f}
                </Chip>
              );
            })}
          </div>
        </Group>

        {showQuantity && (
          <label className="grid max-w-40 gap-1 text-sm font-bold">
            Quantity
            <input
              name="quantity"
              type="number"
              min="1"
              inputMode="numeric"
              value={value.quantity}
              disabled={readOnly}
              onChange={(e) => set({ quantity: e.target.value })}
              className="h-11 rounded-lg border border-input bg-card px-3 text-base tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            />
            {errors.quantity && <span className="text-sm font-medium text-destructive">{errors.quantity}</span>}
          </label>
        )}
        {!showQuantity && <input type="hidden" name="quantity" value={value.quantity} />}
      </div>

      {/* ------------------------------------------- desktop sticky preview */}
      <div className={cn("hidden lg:sticky lg:block", inDialog ? "lg:top-0" : "lg:top-24")}>{isDesktop && previewCard}</div>
    </div>
  );
}
