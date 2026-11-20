import { Plus } from "lucide-react";
import { AppShell, EmptyState, PageTitle, Section } from "@/components/app-shell";
import { DesignNote } from "@/components/design-note";
import { LinkButton } from "@/components/link-button";
import {
  AnswerQuestionDialog,
  ConfirmSpecsDialog,
  EditDetailsDialog,
  LogPaymentDialog,
  ResolveRepairDialog,
  RetrySmsDialog,
  ScheduleDeliveryDialog,
  VerifyHandoverButton,
} from "@/components/office/actions";
import { TaskCard } from "@/components/office/order-card";
import { OrdersTable } from "@/components/office/orders-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toClientOrder } from "@/lib/client-order";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOfficeData, nameOf } from "@/lib/server/office-data";
import { staffTasks } from "@/lib/services/insights";
import { SMS_SIMULATED_NOTE, smsMode } from "@/lib/services/notify";

export const metadata = { title: "Store Assistant" };

export default async function StaffPage() {
  const actor = await requireActor(["staff", "owner"]);
  const data = await loadOfficeData(await getStore());
  const t = staffTasks(data.orders, data.payments, data.deliveries, data.exceptions, data.notifications);
  const byId = new Map(data.orders.map((o) => [o.id, toClientOrder(o)]));
  const drivers = data.profiles.filter((p) => p.role === "driver" && p.is_active);
  const total =
    t.needsConfirmation.length + t.needsDownPayment.length + t.specQuestions.length + t.toSchedule.length +
    t.failedDeliveries.length + t.cashHandovers.length + t.touchUps.length + t.missingFields.length + t.failedSms.length;

  return (
    <AppShell portal={actor.role === "owner" ? "owner" : "staff"} actor={actor}>
      <PageTitle
        title={`Today's work · ${total}`}
        description="Every task below changes the shared order record that the owner, workshop, drivers and customers see."
        actions={<LinkButton href="/staff/new" variant="default" size="xl"><Plus aria-hidden /> New Order</LinkButton>}
      />
      <DesignNote className="mb-4">
        Task queues replace the notebook-and-Messenger juggling seen in the Discover phase: each card is one concrete job with the button that finishes it.
      </DesignNote>

      <Tabs defaultValue="today">
        <TabsList className="mb-3 h-11!">
          <TabsTrigger value="today" className="h-9 px-4">Today&apos;s Work</TabsTrigger>
          <TabsTrigger value="orders" className="h-9 px-4">All Orders ({data.orders.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          <div className="grid gap-x-6 lg:grid-cols-2">
            <Section title="Record customer spec confirmation" count={t.needsConfirmation.length}>
              {t.needsConfirmation.length === 0 ? <EmptyState title="No orders waiting for confirmation" /> : (
                <ul className="grid gap-2">
                  {t.needsConfirmation.map((o) => {
                    const c = byId.get(o.id)!;
                    return (
                      <TaskCard key={o.id} order={c} tone="warning"
                        meta={<>{o.dimensions} · {o.wood_type} · {o.color_finish} · <b className="text-foreground">{formatPeso(o.furniture_price)}</b></>}
                        actions={<><ConfirmSpecsDialog order={c} /><LinkButton href={`/staff/orders/${o.id}/slip`}>Print slip</LinkButton></>} />
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title="Log 30% down payment" count={t.needsDownPayment.length}>
              {t.needsDownPayment.length === 0 ? <EmptyState title="All confirmed orders have their down payment" /> : (
                <ul className="grid gap-2">
                  {t.needsDownPayment.map(({ order, shortfall }) => (
                    <TaskCard key={order.id} order={byId.get(order.id)!} tone="warning"
                      meta={<>Still needed: <b className="text-foreground">{formatPeso(shortfall)}</b> of {formatPeso(order.standard_down_payment_due)}</>}
                      actions={<LogPaymentDialog order={byId.get(order.id)!} defaultAmount={shortfall} />} />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Answer craftsman spec questions" count={t.specQuestions.length}>
              {t.specQuestions.length === 0 ? <EmptyState title="No open questions from the workshop" /> : (
                <ul className="grid gap-2">
                  {t.specQuestions.map((ex) => {
                    const o = byId.get(ex.order_id);
                    if (!o) return null;
                    return (
                      <TaskCard key={ex.id} order={o} tone="info" meta={<>“{ex.description}” — {ex.requested_by}</>}
                        actions={<AnswerQuestionDialog ex={ex} orderCode={o.order_code} />} />
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title="Schedule driver & vehicle" count={t.toSchedule.length + t.failedDeliveries.length}>
              {t.toSchedule.length + t.failedDeliveries.length === 0 ? <EmptyState title="Nothing waiting for a delivery slot" /> : (
                <ul className="grid gap-2">
                  {t.failedDeliveries.map(({ delivery, order }) => (
                    <TaskCard key={delivery.id} order={byId.get(order.id)!} tone="danger"
                      meta={<>Failed {formatDate(delivery.scheduled_date)} ({nameOf(data.profiles, delivery.driver_id)}): {delivery.failure_or_damage_notes}</>}
                      actions={<ScheduleDeliveryDialog order={byId.get(order.id)!} drivers={drivers} />} />
                  ))}
                  {t.toSchedule.filter((o) => !t.failedDeliveries.some((f) => f.order.id === o.id)).map((o) => (
                    <TaskCard key={o.id} order={byId.get(o.id)!}
                      meta={<>{o.municipality} · collect {formatPeso(o.collectible_on_delivery)}{o.payment_exception_type !== "Standard 30/70" && !o.payment_exception_approved ? " · ⚠ owner approval pending" : ""}</>}
                      actions={<ScheduleDeliveryDialog order={byId.get(o.id)!} drivers={drivers} />} />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Verify driver cash handover" count={t.cashHandovers.length}>
              {t.cashHandovers.length === 0 ? <EmptyState title="No cash waiting to be counted" /> : (
                <ul className="grid gap-2">
                  {t.cashHandovers.map(({ payment, order }) => (
                    <TaskCard key={payment.id} order={byId.get(order.id)!}
                      meta={<>{payment.payment_type} · {payment.payment_method} · collected by {nameOf(data.profiles, payment.collected_by_id)} · {formatDateTime(payment.paid_at)}</>}
                      actions={<VerifyHandoverButton paymentId={payment.id} amount={payment.amount} driver={nameOf(data.profiles, payment.collected_by_id)} />} />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Touch-up / repair work orders" count={t.touchUps.length}>
              {t.touchUps.length === 0 ? <EmptyState title="No pending touch-ups" /> : (
                <ul className="grid gap-2">
                  {t.touchUps.map((ex) => {
                    const o = byId.get(ex.order_id);
                    if (!o) return null;
                    return (
                      <TaskCard key={ex.id} order={o} tone="danger" meta={<>{ex.description} — {ex.requested_by}</>}
                        actions={<ResolveRepairDialog ex={ex} orderCode={o.order_code} />} />
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title="Complete missing fields" count={t.missingFields.length}>
              {t.missingFields.length === 0 ? <EmptyState title="All orders have complete details" /> : (
                <ul className="grid gap-2">
                  {t.missingFields.map(({ order, missing }) => (
                    <TaskCard key={order.id} order={byId.get(order.id)!} meta={<>Missing: {missing.join(", ")}</>}
                      actions={<EditDetailsDialog order={byId.get(order.id)!} />} />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Failed SMS updates" count={t.failedSms.length}>
              {t.failedSms.length === 0 ? <EmptyState title="All customer updates were delivered" /> : (
                <ul className="grid gap-2">
                  {t.failedSms.map((n) => {
                    const o = byId.get(n.order_id);
                    if (!o) return null;
                    return (
                      <TaskCard key={n.id} order={o} tone="danger" meta={<>SMS failed: Number not reachable ({n.recipient_phone}){smsMode() === "simulated" ? ` ${SMS_SIMULATED_NOTE}` : ""} · {formatDateTime(n.created_at)}</>}
                        actions={<RetrySmsDialog n={n} />} />
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="orders">
          <OrdersTable orders={data.orders.map(toClientOrder)} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
