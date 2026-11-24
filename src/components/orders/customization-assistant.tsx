"use client";

import { Check, ImagePlus, Info, Sparkles, Undo2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { parseRequest, type AssistantResult } from "@/lib/domain/assistant";
import { Button } from "@/components/ui/button";
import type { ConfigValue } from "./FurnitureConfigurator";

const EXAMPLES = [
  "6 seater narra dining table, 2 meters long, dark finish",
  "kitchen cabinet with glass doors, 150 x 85 x 55 cm, white",
  "arch door 90 x 210 x 4.5 cm mahogany, natural",
];

/**
 * Customization assistant: describe the piece in your own words; the matching
 * choices are applied to the 3D designer (and can be undone). It runs entirely in
 * the browser with fixed rules — it only sets what it is sure about and says so.
 */
export function CustomizationAssistant({ value, onChange, onUsePhoto, onNotes }: {
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  /** offer "Use as reference photo" (absolute URL) when a library photo matches */
  onUsePhoto?: (url: string) => void;
  /** called with the original words when they mention things only a person can answer */
  onNotes?: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [before, setBefore] = useState<ConfigValue | null>(null);
  const [photoUsed, setPhotoUsed] = useState(false);

  const apply = (input: string) => {
    const r = parseRequest(input, { furniture_category: value.furniture_category });
    setResult(r);
    setPhotoUsed(false);
    if (r.notes.length > 0) onNotes?.(input.trim());
    if (Object.keys(r.patch).length === 0) return;
    setBefore(value);
    onChange({ ...value, ...r.patch });
  };

  return (
    <section aria-labelledby="assistant-title" data-testid="assistant" className="grid gap-3 border-y border-border py-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden><Sparkles className="size-4" /></span>
        <div className="min-w-0">
          <h2 id="assistant-title" className="text-lg">Describe it, we set it up</h2>
          <p className="text-sm text-muted-foreground">Type what you have in mind. The type, size, wood and finish are filled in below; you can still change anything.</p>
        </div>
      </div>
      {/* not a <form>: the assistant sits inside the order form, and forms cannot nest */}
      <div className="grid gap-2">
        <label htmlFor="assistant-text" className="sr-only">Describe your furniture</label>
        <textarea id="assistant-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={400}
          placeholder="e.g. 6 seater narra dining table, 2 meters long, dark finish"
          className="min-h-16 w-full resize-y rounded-2xl border border-input bg-card px-4 py-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) apply(text); } }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="touch" className="rounded-full" disabled={!text.trim()} data-testid="assistant-apply" onClick={() => apply(text)}>
            <Sparkles aria-hidden /> Apply to my design
          </Button>
          {before && (
            <Button type="button" size="touch" variant="outline" className="rounded-full" onClick={() => { onChange(before); setBefore(null); setResult(null); }}>
              <Undo2 aria-hidden /> Undo
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => { setText(ex); apply(ex); }}
              className="rounded-full border border-border px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
              {ex}
            </button>
          ))}
        </div>
      </div>

      {result && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" role="status" aria-live="polite" data-testid="assistant-result">
          <div className="grid gap-2 text-sm">
            {result.understood.length > 0 ? (
              <ul className="grid gap-1">
                {result.understood.map((u) => (
                  <li key={u} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{u}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">I could not match that to a type, size, wood or finish. Try words like “dining table”, “2 meters”, “mahogany” or “walnut”, or pick below.</p>
            )}
            {result.notes.map((n) => (
              <p key={n} className="flex gap-2 text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{n}</p>
            ))}
          </div>
          {result.photo && (
            <figure className="grid w-full gap-1.5 sm:w-44" data-testid="assistant-photo">
              <Image src={result.photo.src} alt={result.photo.alt} width={352} height={264} className="aspect-[4/3] w-full rounded-xl bg-[#E7D6C1] object-cover" />
              <figcaption className="text-xs text-muted-foreground">{result.photo.caption}</figcaption>
              {onUsePhoto && (
                <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={photoUsed}
                  onClick={() => { onUsePhoto(new URL(result.photo!.src, window.location.origin).toString()); setPhotoUsed(true); }}>
                  {photoUsed ? <Check aria-hidden /> : <ImagePlus aria-hidden />} {photoUsed ? "Added as reference" : "Use as reference photo"}
                </Button>
              )}
            </figure>
          )}
        </div>
      )}
    </section>
  );
}
