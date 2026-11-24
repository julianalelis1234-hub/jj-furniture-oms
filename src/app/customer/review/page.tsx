import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OpenReviewButton } from "./open-review-button";

export const metadata = { title: "Review your quotation" };

/**
 * Landing page of the emailed review link. Opening the page does NOT use the
 * link (email scanners pre-fetch links); the customer's button press does.
 */
export default async function ReviewLandingPage({ searchParams }: PageProps<"/customer/review">) {
  const token = (await searchParams).token;
  const valid = typeof token === "string" && token.length > 0;
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-md gap-4 rounded-2xl border bg-card p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto size-10 text-primary" aria-hidden />
        <h1 className="text-xl font-bold">Your JJ Enterprises quotation</h1>
        {valid ? (
          <>
            <p className="text-sm text-muted-foreground">
              This secure link works once and opens only this quotation. Continue to review the exact specification and price.
            </p>
            <OpenReviewButton token={token} />
          </>
        ) : (
          <p className="text-sm">This link is incomplete. Open it again from your email, or ask JJ Enterprises to send a new one.</p>
        )}
      </div>
    </AppShell>
  );
}
