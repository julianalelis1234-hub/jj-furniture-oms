"use client";

import { FlaskConical, Info, Lightbulb, Mail, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { resetDemoData, switchDemoRole } from "@/app/actions";
import type { Role } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { useDesignNotes } from "./providers";

const TABS: { role: Role | "customer"; label: string; code: string }[] = [
  { role: "owner", label: "Owner", code: "O-01" },
  { role: "staff", label: "Staff", code: "S-01" },
  { role: "craftsman", label: "Craftsmen", code: "C-01" },
  { role: "driver", label: "Delivery Driver", code: "D-01" },
  { role: "customer", label: "Customer", code: "CU-01" },
];

/**
 * Prototype-only bar for HCI usability testing. Rendered only when
 * NEXT_PUBLIC_APP_MODE=demo; switching a role asks the server to issue a
 * signed demo session — the client never decides permissions.
 */
export function DemoBar({ current }: { current: Role | "customer" | null }) {
  const [pending, start] = useTransition();
  const notes = useDesignNotes();
  const router = useRouter();
  return (
    <div className="no-print bg-demo-bar text-demo-bar-foreground">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold opacity-80">
          <FlaskConical className="size-4" aria-hidden /> Demo
        </span>
        <nav aria-label="Switch demo role" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button
              key={t.role}
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (t.role === "customer") router.push("/customer/login");
                  else await switchDemoRole(t.role);
                })
              }
              className={cn(
                "h-9 shrink-0 rounded-md px-3 text-sm font-medium transition-colors",
                current === t.role ? "bg-demo-bar-foreground text-demo-bar" : "hover:bg-white/15",
              )}
              aria-current={current === t.role ? "page" : undefined}
            >
              {t.label}
              <span className="ml-1 hidden text-[0.7rem] opacity-70 md:inline">{t.code}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => router.push("/demo/inbox")}
            className="flex h-9 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-white/15"
            data-testid="demo-inbox"
          >
            <Mail className="size-4" aria-hidden /> Demo Inbox
          </button>
          <button
            type="button"
            onClick={() => router.push("/about")}
            className="flex h-9 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-white/15"
          >
            <Info className="size-4" aria-hidden /> About
          </button>
          <button
            type="button"
            onClick={notes.toggle}
            className={cn("flex h-9 items-center gap-1.5 rounded-md px-3 text-sm", notes.enabled ? "bg-info text-info-foreground" : "hover:bg-white/15")}
            aria-pressed={notes.enabled}
          >
            <Lightbulb className="size-4" aria-hidden /> Design Notes
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!confirm("Reset all demo data to the original Valencia City sample orders?")) return;
                const r = await resetDemoData();
                if (r.ok) toast.success(r.message);
                else toast.error(r.message);
              })
            }
            className="flex h-9 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-white/15"
          >
            <RotateCcw className="size-4" aria-hidden /> Reset Demo Data
          </button>
        </div>
      </div>
    </div>
  );
}
