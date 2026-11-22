import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";
import { LinkButton } from "@/components/link-button";
import { FurniturePreviewSlot } from "@/components/orders/preview-slot";
import { StageTracker } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DomainError } from "@/lib/domain/errors";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { STATUS_CUSTOMER_COPY } from "@/lib/domain/status";
import { getCustomer, getCustomerStore } from "@/lib/server/customer-auth";
import { customerOwnedOrder } from "@/lib/services/customer-portal";
import { CustomerLogoutButton } from "../../logout-button";
import { PostConfirmationRequest } from "./order-request";

export const metadata = { title: "My order" };

export default async function CustomerOrderDetail({ params }: { params: Promise<{ code: string }> }) {
  const customer = await getCustomer();
  if (!customer) redirect("/customer/login");
  const { code } = await params;
  let data;
  try {
    data = await customerOwnedOrder(await getCustomerStore(), customer.id, decodeURIComponent(code));
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const v = data.view;
  const p = v.payment;
  // the approved revision when there is one; otherwise the latest quotation
  const spec = (v.approved_revision_number && v.quote?.revision_number === v.approved_revision_number ? v.quote : v.quote ?? v.current)!;
  return (
    <AppShell portal="customer" actor={null} headerExtra={<CustomerLogoutButton />} live={<LiveSync orderIds={[data.order.id]} />}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <LinkButton href="/customer/orders" variant="ghost" className="-ml-2 w-fit"><ArrowLeft aria-hidden /> My orders</LinkButton>
        <div>
          <p className="text-sm text-muted-foreground">Order {v.order_code}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{v.quantity} × {v.item_name}</h1>
          <p className="mt-1">{STATUS_CUSTOMER_COPY[v.status]}</p>
        </div>
        <Card><CardContent className="pt-4"><StageTracker status={v.status} /></CardContent></Card>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl border bg-card p-3"><p className="text-xs uppercase text-muted-foreground">Estimated completion</p><p className="font-bold">{formatDate(v.estimated_completion_date)}</p></div>
          <div className="rounded-xl border bg-card p-3"><p className="text-xs uppercase text-muted-foreground">Scheduled delivery</p><p className="font-bold">{formatDate(v.scheduled_delivery_date)}</p></div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:items-start">
          <Card data-testid="approved-spec">
            <CardHeader>
              <CardTitle>
                {v.approved_revision_number ? `Approved specification & quotation · revision ${v.approved_revision_number}` : `Latest quotation · revision ${spec?.revision_number}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {spec && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Design</dt><dd className="font-semibold">{spec.spec.design_variant ?? "—"} {spec.spec.furniture_category ?? ""}</dd>
                  <dt className="text-muted-foreground">Size</dt><dd className="font-semibold tabular-nums">{spec.spec.width_cm != null ? `${spec.spec.width_cm} × ${spec.spec.height_cm} × ${spec.spec.depth_cm} cm (W × H × D)` : `Dimensions Pending Clarification — ${spec.legacy_dimensions_text ?? v.dimensions}`}</dd>
                  <dt className="text-muted-foreground">Wood</dt><dd className="font-semibold">{spec.spec.wood_type}</dd>
                  <dt className="text-muted-foreground">Finish</dt><dd className="font-semibold">{spec.spec.color_finish}</dd>
                  <dt className="text-muted-foreground">Quoted price</dt><dd className="font-bold tabular-nums">{formatPeso(spec.quoted_furniture_price)}</dd>
                  <dt className="text-muted-foreground">Delivery fee</dt><dd className="tabular-nums">{spec.quoted_delivery_fee === 0 ? "FREE" : formatPeso(spec.quoted_delivery_fee)}</dd>
                </dl>
              )}
              {v.status === "Waiting for Confirmation" && (
                <p className="rounded-lg bg-accent-soft p-2">To accept this quotation, open the review link in the latest email from JJ Furniture.</p>
              )}
            </CardContent>
          </Card>
          {spec && <FurniturePreviewSlot spec={spec.spec} legacyDimensions={spec.legacy_dimensions_text} />}
        </div>
        {v.spec_state === "locked" && (
          <Card data-testid="post-confirmation">
            <CardHeader><CardTitle>Need a change or a repair?</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <PostConfirmationRequest orderCode={v.order_code} status={v.status} />
              {v.open_repairs.length > 0 && (
                <ul className="grid gap-1" data-testid="open-requests">
                  {v.open_repairs.map((r, i) => (
                    <li key={i} className="rounded-lg border p-2"><b>{r.status}</b> · {r.description} <span className="text-muted-foreground">· {formatDateTime(r.created_at)}</span></li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        <Card data-testid="payment-summary">
          <CardHeader><CardTitle>Payment summary</CardTitle></CardHeader>
          <CardContent>
            {p.furniture_price == null ? <p className="text-sm text-muted-foreground">No price yet — your quotation will be emailed to you.</p> : (
              <dl className="grid gap-1 text-sm">
                <div className="flex justify-between"><dt>Furniture price</dt><dd className="font-semibold tabular-nums">{formatPeso(p.furniture_price)}</dd></div>
                <div className="flex justify-between"><dt>30% down payment</dt><dd className="tabular-nums">{formatPeso(p.standard_down_payment_due)}</dd></div>
                <div className="flex justify-between"><dt>Paid so far (verified)</dt><dd className="tabular-nums text-success">− {formatPeso(p.furniture_paid)}</dd></div>
                <div className="flex justify-between"><dt>Remaining furniture balance</dt><dd className="tabular-nums">{formatPeso(p.remaining_furniture_balance)}</dd></div>
                <div className="flex justify-between"><dt>Delivery fee</dt><dd className="tabular-nums">{p.delivery_fee === 0 ? "FREE (Valencia City)" : formatPeso(p.delivery_fee)}</dd></div>
                <div className="mt-1 flex justify-between border-t pt-1.5 text-base"><dt className="font-bold">To pay on delivery</dt><dd className="font-black tabular-nums">{formatPeso(p.collectible_on_delivery)}</dd></div>
              </dl>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
          <CardContent>
            <ol className="grid gap-1.5 border-l-2 pl-4 text-sm">
              {v.timeline.map((t, i) => (<li key={i}><b>{t.to_status}</b> <span className="text-muted-foreground">· {formatDateTime(t.changed_at)}</span></li>))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
