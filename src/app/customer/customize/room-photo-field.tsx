"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

const MAX_SIDE = 1600;

/** Shrinks a phone photo to at most 1600 px (JPEG) so it uploads quickly on mobile data. */
async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("encode failed");
  return new File([blob], "room-photo.jpg", { type: "image/jpeg" });
}

/** "Photo of your room" (optional): e.g. the AR photo, so the shop sees where the piece will go. */
export function RoomPhotoField({ value, onChange }: { value: File | null; onChange: (f: File | null) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  return (
    <div className="grid gap-1.5 sm:col-span-2" data-testid="room-photo-field">
      <label htmlFor={id} className="text-sm font-semibold">Photo of your room (optional)</label>
      <p className="text-xs text-muted-foreground">Used <b>View in your room</b> on the 3D model? Add that photo here so the shop can see where it will go.</p>
      {value && preview ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
          <img src={preview} alt="Your room photo" className="size-16 rounded-lg object-cover" />
          <span className="min-w-0 flex-1 text-sm">Photo added · {(value.size / 1024).toFixed(0)} KB</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove the room photo"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"><X className="size-4" aria-hidden /></button>
        </div>
      ) : (
        <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 px-4 py-3 text-sm font-semibold text-primary hover:bg-accent-soft has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          {busy ? "Preparing photo…" : "Add a photo"}
          <input id={id} type="file" accept="image/*" className="sr-only" data-testid="room-photo-input" disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setError(null);
              setBusy(true);
              try { onChange(await shrink(f)); }
              catch { setError("That photo could not be read. Choose a JPG or PNG photo."); }
              finally { setBusy(false); }
            }} />
        </label>
      )}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
