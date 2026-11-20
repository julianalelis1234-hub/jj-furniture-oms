"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/use-browser";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="outline"
      size="touch"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to Normal (light) mode" : "Switch to Dark mode"}
      title={dark ? "Normal mode" : "Dark mode"}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
      <span className="hidden sm:inline">{dark ? "Normal" : "Dark"}</span>
    </Button>
  );
}
