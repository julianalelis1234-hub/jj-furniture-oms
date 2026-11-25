import { ArrowLeft, Lock } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { LinkButton } from "@/components/link-button";
import { FurniturePreviewSlot } from "@/components/orders/preview-slot";
import { PortalShell } from "@/components/portal-shell";
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
import { AcceptQuotation, SubmitPayment, type ShopAccounts } from "./quote-and-pay";
import { isDemoMode } from "@/lib/config";
import { PAYMENT_PLAN_LABEL } from "@/lib/domain/types";
import { InstallmentTable } from "@/components/orders/installment-table";
import { cn } from "@/lib/utils";

/** Where customers send online / bank payments. Demo Mode shows fictional details; production reads them from the environment. */
function shopAccounts(): ShopAccounts {
  if (isDemoMode()) return { gcash: "GCash / Maya 0900-000-0000 · JJ Enterprises (demo)", bank: "Demo Bank · account 0000-0000-0000 · JJ Enterprises (demo)" };
  return { gcash: process.env.SHOP_GCASH_DETAILS?.trim() || null, bank: process.env.SHOP_BANK_DETAILS?.trim() || null };
}

/** What the next payment should be: the rest of the 30% (or of the full price), minus what is already waiting to be checked. */
function suggestedAmount(v: Awaited<ReturnType<typeof customerOwnedOrder>>["view"]): number | null {
  const pending = v.payments.filter((x) => x.state === "pending").reduce((s, x) => s + x.amount, 0);
  const nextDue = v.installments?.find((r) => r.state !== "paid");
  const target = v.payment_plan === "full" ? v.payment.remaining_furniture_balance
    : v.payment_plan === "down_30" ? v.payment.standard_down_payment_due - v.payment.furniture_paid
    : nextDue ? nextDue.amount - nextDue.paid : 0;
  const left = Math.round((target - pending) * 100) / 100;
  return left > 0 ? left : null;
}

const PAY_STATE = { pending: "Being checked", verified: "Verified", rejected: "Not accepted" } as const;

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
    <PortalShell portal="customer" actor={null} name={customer.full_name} signOutControl={<CustomerLogoutButton compact />} headerExtra={<CustomerLogoutButton />} live={{ orderIds: [data.order.id] }}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <LinkButton href="/customer/orders" variant="ghost" className="-ml-2 w-fit"><ArrowLeft aria-hidden /> My orders</LinkButton>
        <div>
          <p className="text-sm text-muted-foreground">Order {v.order_code}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{v.quantity} × {v.item_name}</h1>
          <p className="mt-1">{STATUS_CUSTOMER_COPY[v.status]}</p>
        </div>
        <Card><CardContent className="pt-4"><StageTracker status={v.status} /></CardContent></Card>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl border bg-card p-3"><p className="text-xs font-semibold text-muted-foreground">Estimated completion</p><p className="font-bold">{formatDate(v.estimated_completion_date)}</p></div>
          <div className="rounded-xl border bg-card p-3"><p className="text-xs font-semibold text-muted-foreground">Scheduled delivery</p><p className="font-bold">{formatDate(v.scheduled_delivery_date)}</p></div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:items-start">
          <Card data-testid="approved-spec">
            <CardHeader>
              <CardTitle>
                {v.approved_revision_number ? `Approved specification & quotation · revision ${v.approved_revision_number}` : `Latest quotation · revision ${spec?.revision_number}`}
              </CardTitle>
              {v.spec_state === "locked" && (
                <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-xs font-bold text-background" data-testid="spec-locked">
                  <Lock className="size-3.5" aria-hidden /> Locked for production — changes need the shop&apos;s approval
                </p>
              )}
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
              {spec?.quoted_furniture_price == null && <p className="text-muted-foreground">The price appears here once the shop issues your quotation.</p>}
            </CardContent>
          </Card>
          {spec && <FurniturePreviewSlot spec={spec.spec} legacyDimensions={spec.legacy_dimensions_text} />}
        </div>
        <section aria-labelledby="next-title" data-testid="customer-next-step" className="grid gap-4 border-y border-border py-6">
          <h2 id="next-title" className="text-2xl">
            {v.spec_state === "submitted" ? "We received your order"
              : v.spec_state === "awaiting_quotation" ? "Your order is confirmed"
              : v.spec_state === "awaiting_acceptance" ? "Accept your quotation"
              : v.spec_state === "accepted" || v.spec_state === "locked" ? "Payments" : "Quotation"}
          </h2>
          {v.spec_state === "submitted" && <p>The shop is checking your design. You will get an email once your order <b>{v.order_code}</b> is confirmed.</p>}
          {v.spec_state === "awaiting_quotation" && <p>The shop is preparing your official quotation. It will appear here, and you will get an email when it is ready.</p>}
          {(v.spec_state === "proposal_under_review" || v.spec_state === "needs_shop_review") && <p>The shop is reviewing a change on your order and will send you an updated quotation.</p>}
          {v.spec_state === "quote_expired" && <p>This quotation has expired. The shop will send you a fresh one; you can also call the shop with your Order ID {v.order_code}.</p>}
          {v.spec_state === "awaiting_acceptance" && v.current?.quoted_furniture_price != null && (
            <AcceptQuotation orderCode={v.order_code} revisionNumber={v.current.revision_number}
              price={v.current.quoted_furniture_price} fee={v.current.quoted_delivery_fee ?? 0} down={p.standard_down_payment_due} />
          )}
          {(v.spec_state === "accepted" || v.spec_state === "locked") && (<>
            {v.payment_plan && <p>Your terms: <b>{PAYMENT_PLAN_LABEL[v.payment_plan]}</b>{v.preferred_payment_method && <> · {v.preferred_payment_method}</>}.</p>}
            {v.payment_plan === "installment" && (v.installments ? (
              <div className="grid gap-2" data-testid="customer-installments">
                <p className="text-sm font-semibold">Your payment schedule: one payment every 15 days, no down payment.</p>
                <InstallmentTable rows={v.installments} />
              </div>
            ) : <p className="text-sm text-muted-foreground">The shop is preparing your installment schedule. You will see the amounts and due dates here.</p>)}
            {p.remaining_furniture_balance > 0 && v.status !== "Delivered" && (<>
              <SubmitPayment orderCode={v.order_code} max={p.remaining_furniture_balance} preferred={v.preferred_payment_method} accounts={shopAccounts()}
                suggested={suggestedAmount(v)} />
              <p className="text-sm text-muted-foreground">Paying cash? Bring it to the shop in Poblacion, Valencia City. The staff records it for you.</p>
            </>)}
          </>)}
          {v.payments.length > 0 && (
            <ul className="divide-y divide-border border-y border-border" data-testid="customer-payments">
              {v.payments.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                  <b className="tabular-nums">{formatPeso(x.amount)}</b>
                  <span className="text-muted-foreground">{x.payment_method}{x.reference_number && ` · ref. ${x.reference_number}`} · {formatDateTime(x.paid_at)}</span>
                  <span className={cn("ml-auto rounded-full px-3 py-1 text-xs font-bold",
                    x.state === "verified" ? "bg-success-soft text-success" : x.state === "rejected" ? "bg-destructive/10 text-destructive" : "bg-warning-soft text-warning")}>{PAY_STATE[x.state]}</span>
                  {x.rejection_reason && <span className="w-full text-destructive">{x.rejection_reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
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
        {/* two-tone ledger: Latte header, Cream body, Espresso figures */}
        <Card data-testid="payment-summary" className="gap-0 py-0">
          <CardHeader className="border-b bg-secondary py-3"><CardTitle>Payment summary</CardTitle></CardHeader>
          <CardContent className="bg-background py-4">
            {p.furniture_price == null ? <p className="text-sm text-muted-foreground">No price yet. Your quotation will appear here after the shop confirms your order.</p> : (
              <dl className="grid gap-1 text-sm">
                <div className="flex justify-between"><dt>Furniture price</dt><dd className="font-semibold tabular-nums">{formatPeso(p.furniture_price)}</dd></div>
                {v.payment_plan !== "installment" && <div className="flex justify-between"><dt>{v.payment_plan === "full" ? "Full payment before production" : "30% down payment"}</dt><dd className="tabular-nums">{formatPeso(v.payment_plan === "full" ? p.furniture_price : p.standard_down_payment_due)}</dd></div>}
                <div className="flex justify-between"><dt>Paid so far (verified)</dt><dd className="tabular-nums text-success">− {formatPeso(p.furniture_paid)}</dd></div>
                <div className="flex justify-between"><dt>Remaining furniture balance</dt><dd className="tabular-nums">{formatPeso(p.remaining_furniture_balance)}</dd></div>
                <div className="flex justify-between"><dt>Delivery fee</dt><dd className="tabular-nums">{p.delivery_fee === 0 ? "FREE (Valencia City)" : formatPeso(p.delivery_fee)}</dd></div>
                {v.payment_plan === "installment"
                  ? <p className="mt-1 border-t pt-1.5 text-sm text-muted-foreground">The balance is paid by your schedule, not all on delivery.</p>
                  : <div className="mt-1 flex justify-between border-t pt-1.5 text-base"><dt className="font-bold">To pay on delivery</dt><dd className="font-black tabular-nums">{formatPeso(p.collectible_on_delivery)}</dd></div>}
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
    </PortalShell>
  );
}
