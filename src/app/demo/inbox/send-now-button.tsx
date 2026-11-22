"use client";

import { Send } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendQueuedEmailsNowAction } from "./actions";

export function SendNowButton() {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={pending} data-testid="send-queued-now"
      onClick={() => start(async () => { const r = await sendQueuedEmailsNowAction(); (r.ok ? toast.success : toast.error)(r.message); })}>
      <Send aria-hidden /> {pending ? "Sending…" : "Send pending emails now"}
    </Button>
  );
}
