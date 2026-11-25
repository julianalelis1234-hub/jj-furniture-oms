"use client";

import { Camera, Check, ImagePlus, Info, Loader2, Sparkles, Undo2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { AiDesignResult } from "@/lib/domain/ai-design";
import { PHOTO_LIBRARY, parseRequest, type AssistantResult } from "@/lib/domain/assistant";
import { Button } from "@/components/ui/button";
import { PREVIEW_UPDATED_EVENT, type ConfigValue } from "./FurnitureConfigurator";

const EXAMPLES = [
  "6 seater narra dining table, 2 meters long, dark finish",
  "rocking chair in mahogany, walnut stain",
  "chest of drawers with 6 drawers, 80 x 110 x 45 cm, gmelina",
  "TV stand 160 cm wide with 2 doors and 2 drawers, dark",
];

type Source = "ai" | "rules";

/** Phone photos are shrunk to 1024 px (JPEG) before they are sent. */
async function shrinkPhoto(file: File): Promise<{ mimeType: "image/jpeg"; data: string; preview: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const url = c.toDataURL("image/jpeg", 0.82);
  return { mimeType: "image/jpeg", data: url.slice(url.indexOf(",") + 1), preview: url };
}

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
  const [result, setResult] = useState<(AssistantResult & { source: Source }) | null>(null);
  const [before, setBefore] = useState<ConfigValue | null>(null);
  const [photoUsed, setPhotoUsed] = useState(false);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<{ mimeType: "image/jpeg"; data: string; preview: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // is the AI designer switched on (GEMINI_API_KEY on the server)?
  useEffect(() => {
    let live = true;
    fetch("/api/design-assistant").then((r) => r.json()).then((j) => { if (live) setAi(!!j.ai); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const applyPatch = (r: AssistantResult, source: Source, words: string, shopNote?: string | null) => {
    setResult({ ...r, source });
    setPhotoUsed(false);
    if (shopNote) onNotes?.(shopNote);
    else if (r.notes.length > 0 && words.trim()) onNotes?.(words.trim());
    if (Object.keys(r.patch).length === 0) return;
    setBefore(value);
    onChange({ ...value, ...r.patch });
    window.dispatchEvent(new Event(PREVIEW_UPDATED_EVENT)); // the 3D view highlights the change (and opens on phones)
  };

  const local = (input: string, extraNote?: string) => {
    const r = parseRequest(input, { furniture_category: value.furniture_category, design_variant: value.design_variant });
    if (extraNote) r.notes.unshift(extraNote);
    applyPatch(r, "rules", input);
  };

  const apply = async (input: string) => {
    if (!ai) {
      if (photo && !input.trim()) { setPhotoError("Reading photos is not switched on yet. Describe the piece in words instead."); return; }
      local(input);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/design-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input, image: photo ? { mimeType: photo.mimeType, data: photo.data } : undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.result) {
        const r = j.result as AiDesignResult;
        const cat = r.patch.furniture_category ?? value.furniture_category;
        const lib = cat ? PHOTO_LIBRARY.find((p) => p.category === cat) : null;
        applyPatch({ patch: r.patch, understood: r.understood, notes: r.notes, photo: lib ? { src: lib.src, alt: lib.alt, caption: lib.caption } : null }, "ai", input, r.shopNote);
        return;
      }
      if (input.trim()) local(input, j.code === "RATE_LIMITED" ? "You sent many requests; this one was read with the quick rules." : "The AI designer is busy, so the quick rules read this instead.");
      else setPhotoError("The photo could not be read right now. Please try again in a minute, or describe it in words.");
    } catch {
      if (input.trim()) local(input, "The AI designer could not be reached, so the quick rules read this instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="assistant-title" data-testid="assistant" className="grid gap-3 border-y border-border py-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden><Sparkles className="size-4" /></span>
        <div className="min-w-0">
          <h2 id="assistant-title" className="text-lg">Describe it, we set it up</h2>
          <p className="text-sm text-muted-foreground">Type what you have in mind{ai ? ", or add a photo of a piece you like," : ""} and press Apply. The 3D model and the choices below update at once; you can still change anything.</p>
        </div>
      </div>
      {/* not a <form>: the assistant sits inside the order form, and forms cannot nest */}
      <div className="grid gap-2">
        <label htmlFor="assistant-text" className="sr-only">Describe your furniture</label>
        <textarea id="assistant-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={400}
          placeholder="e.g. 6 seater narra dining table, 2 meters long, dark finish"
          className="min-h-16 w-full resize-y rounded-2xl border border-input bg-card px-4 py-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if ((text.trim() || photo) && !busy) void apply(text); } }} />
        {photo && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-2" data-testid="assistant-photo-added">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the customer's photo */}
            <img src={photo.preview} alt="Your furniture photo" className="size-14 rounded-lg object-cover" />
            <span className="min-w-0 flex-1 text-sm">Photo added. Press Apply to read it{text.trim() ? " with your words" : ""}.</span>
            <button type="button" onClick={() => setPhoto(null)} aria-label="Remove the photo" className="grid size-10 place-items-center rounded-full hover:bg-muted"><X className="size-4" aria-hidden /></button>
          </div>
        )}
        {photoError && <p role="alert" className="text-sm font-medium text-destructive">{photoError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="touch" className="rounded-full" disabled={busy || (!text.trim() && !photo)} data-testid="assistant-apply" onClick={() => apply(text)}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} {busy ? "Reading…" : "Apply to my design"}
          </Button>
          {ai && (
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-primary/50 px-4 text-sm font-semibold text-primary hover:bg-accent-soft has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40" data-testid="assistant-photo-button">
              <Camera className="size-4" aria-hidden /> {photo ? "Change photo" : "Add a photo"}
              <input type="file" accept="image/*" className="sr-only" data-testid="assistant-photo-input"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setPhotoError(null);
                  try { setPhoto(await shrinkPhoto(f)); } catch { setPhotoError("That photo could not be opened. Choose a JPG or PNG photo."); }
                }} />
            </label>
          )}
          {before && (
            <Button type="button" size="touch" variant="outline" className="rounded-full" onClick={() => { onChange(before); setBefore(null); setResult(null); window.dispatchEvent(new Event(PREVIEW_UPDATED_EVENT)); }}>
              <Undo2 aria-hidden /> Undo
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" disabled={busy} onClick={() => { setText(ex); void apply(ex); }}
              className="rounded-full border border-border px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
              {ex}
            </button>
          ))}
        </div>
      </div>

      {result && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" role="status" aria-live="polite" data-testid="assistant-result">
          <div className="grid gap-2 text-sm">
            <p className="text-xs font-semibold text-muted-foreground" data-testid="assistant-source">{result.source === "ai" ? "Read by the AI designer (Gemini). Check the choices below." : "Read with the quick rules."}</p>
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
