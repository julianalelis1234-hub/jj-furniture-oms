"use client";

import { Gem, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/use-browser";
import { cn } from "@/lib/utils";

/** The three colour themes: Normal (light), Dark (espresso) and Premium black (black + champagne gold). */
export const THEMES = [
  { id: "light", label: "Normal", aria: "Switch to Normal (light) mode", icon: Sun },
  { id: "dark", label: "Dark", aria: "Switch to Dark mode", icon: Moon },
  { id: "premium", label: "Premium", aria: "Switch to Premium black mode", icon: Gem },
] as const;

/** Dark-looking themes (both use the dark styles; premium swaps the palette). */
export const isDarkTheme = (t: string | undefined) => t === "dark" || t === "premium";

/** A small segmented switch: one icon per theme; the current one is raised. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();
  const current = mounted ? resolvedTheme : undefined;
  return (
    <div role="group" aria-label="Colour theme" className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
      {THEMES.map((t) => {
        const on = current === t.id;
        const Icon = t.icon;
        return (
          <button key={t.id} type="button" onClick={() => setTheme(t.id)} aria-pressed={on} aria-label={t.aria} title={`${t.label} theme`}
            className={cn("inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:h-10 sm:min-w-10",
              on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <Icon className="size-4" aria-hidden />
            {on && <span className="hidden sm:inline">{t.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
