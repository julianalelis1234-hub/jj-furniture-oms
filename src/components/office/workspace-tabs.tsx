"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { value: "overview", label: "Overview & 3D Spec" },
  { value: "quotation", label: "Quotation & Revisions" },
  { value: "payments", label: "Payments & Gate" },
] as const;

/** The drawer's three tabs; panels are server-rendered and only the active one is mounted (one 3D renderer at most). */
export function WorkspaceTabs({ panels, initial }: { panels: Record<(typeof TABS)[number]["value"], ReactNode>; initial?: string }) {
  const start = TABS.some((t) => t.value === initial) ? initial! : "overview";
  return (
    <Tabs defaultValue={start}>
      <TabsList className="h-auto! w-full flex-wrap justify-start gap-1 p-1">
        {TABS.map((t) => <TabsTrigger key={t.value} value={t.value} className="h-10 min-w-0 flex-1 px-3 text-sm whitespace-normal">{t.label}</TabsTrigger>)}
      </TabsList>
      {TABS.map((t) => <TabsContent key={t.value} value={t.value} className="mt-3">{panels[t.value]}</TabsContent>)}
    </Tabs>
  );
}
