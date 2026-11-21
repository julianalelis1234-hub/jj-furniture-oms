import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StageTracker } from "@/components/status";
import { getPublicStore } from "@/lib/server/context";
import { getReviewSession } from "@/lib/server/customer-auth";
import { reviewView } from "@/lib/services/customer-portal";
import { ReviewQuote } from "./review-quote";

export const metadata = { title: "Review your quotation" };

/** Review session page: exactly one order and one quotation revision (from the signed review cookie). */
export default async function ReviewQuotePage() {
  const scope = await getReviewSession();
  if (!scope) redirect("/customer/review");
  const view = await reviewView(await getPublicStore(), scope);
  const v = view.order;
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Order {v.order_code} · for {v.customer_name}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{v.quantity} × {v.item_name}</h1>
        </div>
        <div className="rounded-xl border bg-card p-4"><StageTracker status={v.status} /></div>
        <ReviewQuote view={view} />
      </div>
    </AppShell>
  );
}
