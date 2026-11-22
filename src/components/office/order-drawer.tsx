"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Right-hand slide-over (desktop) / full-screen sheet (phones) for one order.
 * Opened by the ?order=<id> query, so it survives live-sync refreshes and can be
 * linked. Escape or the close button returns to the queue (filters are kept).
 */
export function OrderDrawer({ closeHref, children }: { closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // a dialog opened from inside the drawer handles its own Escape
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]:not([data-order-drawer]), [role="alertdialog"]')) router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener("keydown", onKey); };
  }, [closeHref, router]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close order" tabIndex={-1} className="absolute inset-0 hidden bg-[#2b1d17]/45 backdrop-blur-[1px] sm:block"
        onClick={() => router.push(closeHref, { scroll: false })} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="drawer-title" data-order-drawer data-testid="order-drawer"
        className="relative h-full w-full overflow-y-auto overscroll-contain bg-background shadow-2xl outline-none sm:max-w-[min(960px,94vw)] sm:border-l sm:border-live/50">
        <div className="sticky top-0 z-10 flex items-center justify-end border-b bg-background/95 px-4 py-2 backdrop-blur">
          <button type="button" onClick={() => router.push(closeHref, { scroll: false })} data-testid="drawer-close"
            className="flex h-11 items-center gap-1.5 rounded-full border border-primary/60 px-4 text-sm font-semibold text-primary hover:bg-accent-soft">
            <X className="size-4" aria-hidden /> Close
          </button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
