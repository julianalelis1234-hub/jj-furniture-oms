"use client";

import { ThemeProvider } from "next-themes";
import { createContext, useContext, type ReactNode } from "react";
import { useStoredFlag } from "@/lib/use-browser";
import { Toaster } from "@/components/ui/sonner";

const DesignNotesContext = createContext<{ enabled: boolean; toggle: () => void }>({ enabled: false, toggle: () => {} });
export const useDesignNotes = () => useContext(DesignNotesContext);

export function Providers({ children, demo }: { children: ReactNode; demo: boolean }) {
  const [enabled, setEnabled] = useStoredFlag("jj-design-notes");
  const toggle = () => setEnabled(!enabled);
  return (
    <ThemeProvider attribute="class" defaultTheme="light" themes={["light", "dark", "premium"]} enableSystem={false} disableTransitionOnChange>
      <DesignNotesContext.Provider value={{ enabled: demo && enabled, toggle }}>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </DesignNotesContext.Provider>
    </ThemeProvider>
  );
}
