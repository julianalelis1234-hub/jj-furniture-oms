"use client";

import { Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action-result";
import type { VariantProps } from "class-variance-authority";
import { useServerAction } from "./form";

type BtnVariant = VariantProps<typeof buttonVariants>["variant"];
type BtnSize = VariantProps<typeof buttonVariants>["size"];

/**
 * Button that opens a modal form; submitting runs a server action. The dialog
 * stays open with field errors on failure and closes only on a confirmed save.
 */
export function ActionDialog<T>({
  trigger,
  icon,
  variant = "default",
  size = "touch",
  title,
  description,
  submitLabel,
  submitVariant = "default",
  action,
  children,
  wide,
  onDone,
  triggerClassName,
}: {
  trigger: string;
  icon?: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  submitVariant?: BtnVariant;
  action: (fd: FormData) => Promise<ActionResult<T>>;
  children: ReactNode | ((errors: Record<string, string>) => ReactNode);
  wide?: boolean;
  onDone?: (data?: T) => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run, errors, setErrors } = useServerAction();
  return (
    <>
      <Button variant={variant} size={size} className={triggerClassName} onClick={() => { setErrors({}); setOpen(true); }}>
        {icon}
        {trigger}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className={wide ? "max-h-[90dvh] overflow-y-auto sm:max-w-2xl" : "max-h-[90dvh] overflow-y-auto sm:max-w-md"}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => action(fd), (r) => {
                setOpen(false);
                onDone?.(r.data);
              });
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle className="text-lg">{title}</DialogTitle>
              {description && <DialogDescription className="text-sm">{description}</DialogDescription>}
            </DialogHeader>
            {typeof children === "function" ? children(errors) : children}
            {errors._form && <p className="text-sm font-medium text-destructive">{errors._form}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant={submitVariant} size="touch" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {pending ? "Saving…" : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One-tap action button (no form) with pending state. */
export function ActionButton<T>({
  children,
  action,
  variant = "outline",
  size = "touch",
  confirmText,
  className,
  disabled,
}: {
  children: ReactNode;
  action: () => Promise<ActionResult<T>>;
  variant?: BtnVariant;
  size?: BtnSize;
  confirmText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending, run } = useServerAction();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={pending || disabled}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        run(action);
      }}
    >
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
