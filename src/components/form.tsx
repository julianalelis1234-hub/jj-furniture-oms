"use client";

import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-base text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive disabled:opacity-60";

export function TextInput({ invalid, className, ...props }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={cn(control, className)} {...props} />;
}

export function TextArea({ invalid, className, ...props }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cn(control, "h-auto min-h-24 py-2", className)} {...props} />;
}

/** Native select: fastest and most reliable picker on low-end Android browsers. */
export function NativeSelect({
  invalid,
  className,
  options,
  placeholder,
  ...props
}: ComponentProps<"select"> & { invalid?: boolean; options: readonly (string | { value: string; label: string })[]; placeholder?: string }) {
  return (
    <select aria-invalid={invalid || undefined} className={cn(control, "pr-8", className)} {...props}>
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => {
        const v = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        );
      })}
    </select>
  );
}

/** Runs a server action with pending state and honest success/error toasts. */
export function useServerAction() {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  function run<T>(fn: () => Promise<ActionResult<T>>, onSuccess?: (r: { data?: T }) => void) {
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          setErrors({});
          if (r.message) toast.success(r.message);
          onSuccess?.(r);
        } else {
          setErrors(r.fieldErrors ?? {});
          toast.error(r.message);
        }
      } catch {
        toast.error("Could not reach the server. Check your signal — nothing was saved.");
      }
    });
  }
  return { pending, run, errors, setErrors };
}
