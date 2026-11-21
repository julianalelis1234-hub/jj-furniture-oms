"use client";

import { FileSearch, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { openReviewAction } from "@/app/customer/actions";
import { Button } from "@/components/ui/button";

export function OpenReviewButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <Button
        size="xl"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await openReviewAction(token);
            if (r && !r.ok) setError(r.message);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FileSearch aria-hidden />} Open my quotation
      </Button>
      {error && <p role="alert" className="text-sm font-medium text-destructive" data-testid="review-error">{error}</p>}
    </div>
  );
}
