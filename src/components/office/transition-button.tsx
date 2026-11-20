"use client";

import { transitionAction } from "@/app/actions";
import { ActionButton } from "@/components/action-dialog";
import type { OrderStatus } from "@/lib/domain/types";
import type { ReactNode } from "react";

export function TransitionButton({
  orderId,
  to,
  version,
  children,
  variant = "default",
  confirmText,
}: {
  orderId: string;
  to: OrderStatus;
  version: number;
  children: ReactNode;
  variant?: "default" | "outline" | "success" | "warning";
  confirmText?: string;
}) {
  return (
    <ActionButton variant={variant} confirmText={confirmText} action={() => transitionAction(orderId, to, version)}>
      {children}
    </ActionButton>
  );
}
