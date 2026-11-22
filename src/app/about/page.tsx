import {
  ArrowRight,
  ClipboardList,
  Hammer,
  MessageSquareWarning,
  PackageSearch,
  ShieldCheck,
  Store,
  Truck,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { DemoBar } from "@/components/demo-bar";
import { Logo } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { isDemoMode } from "@/lib/config";
import { ORDER_STATUSES } from "@/lib/domain/types";

export const metadata = { title: "About the Hybrid OMS" };

const PROBLEMS: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <ClipboardList />,
    title: "Fragmented paper slips",
    text: "Orders lived on handwritten slips, notebooks and Messenger chats. Nobody could see an order's full status in one place.",
  },
  {
    icon: <MessageSquareWarning />,
    title: "Verbal priorities",
    text: "“Unahon ni” (do this first) was said out loud in the workshop, so priorities changed without a record and specs were misheard.",
  },
  {
    icon: <WifiOff />,
    title: "Delivery coordination gaps",
    text: "Provincial routes (Lantapan, Cabanglasan, Pangantucan, San Fernando) lose signal; cash collected and failed trips were reported late or forgotten.",
  },
  {
    icon: <PackageSearch />,
    title: "Repeated customer follow-ups",
    text: "Customers had to call or message to ask “tapos na ba?” — and completion dates were confused with delivery dates.",
  },
];

const PORTALS: { icon: ReactNode; code: string; title: string; text: string }[] = [
  { icon: <ShieldCheck />, code: "O-01", title: "Owner", text: "8 live KPIs, approvals, quality inspection, Planning Board." },
  { icon: <Store />, code: "S-01", title: "Store Staff", text: "Encode paper slips, record confirmations & 30% payments, schedule drivers." },
  { icon: <Hammer />, code: "C-01", title: "Craftsmen", text: "Priority-sorted job cards with no prices. Start, Ready, Ask." },
  { icon: <Truck />, code: "D-01", title: "Delivery Driver", text: "Assigned trips, exact amount to collect, works offline." },
  { icon: <PackageSearch />, code: "CU-01", title: "Customer", text: "Email + password login to track orders; customize & request a quote; one-time emailed review links." },
];

export default function AboutPage() {
  const demo = isDemoMode();
  return (
    <div className="flex min-h-dvh flex-col">
      {demo && <DemoBar current={null} />}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Logo />
          <div className="ml-auto"><ThemeToggle /></div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        <p className="text-sm font-semibold tracking-wide text-primary uppercase">HCI Design Phase II · Concept 3</p>
        <h1 className="mt-1 text-4xl font-semibold sm:text-5xl">Hybrid Order Monitoring System</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted-foreground">
          <b className="text-foreground">JJ Furniture Shop and Enterprises</b>, Poblacion, Valencia City, Bukidnon, builds custom
          Mahogany and Gmelina furniture to order. This system keeps the paper slip at the counter and gives every role one shared,
          live order record in an ordinary phone browser. There is nothing to install and no monthly software fee.
        </p>

        <section className="mt-8" aria-labelledby="problem">
          <h2 id="problem" className="text-xl font-bold">What we found in the Discover phase</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMS.map((p) => (
              <li key={p.title} className="rounded-xl border bg-card p-4">
                <span className="flex size-10 items-center justify-center rounded-lg bg-danger-soft text-destructive [&_svg]:size-5">{p.icon}</span>
                <p className="mt-2 font-bold">{p.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8" aria-labelledby="solution">
          <h2 id="solution" className="text-xl font-bold">One record, five portals</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PORTALS.map((p) => (
              <li key={p.code} className="rounded-xl border bg-card p-4">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-primary [&_svg]:size-5">{p.icon}</span>
                <p className="mt-2 font-bold">{p.title} <span className="text-xs font-normal text-muted-foreground">{p.code}</span></p>
                <p className="mt-1 text-sm text-muted-foreground">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8" aria-labelledby="lifecycle">
          <h2 id="lifecycle" className="text-xl font-bold">The 7-stage order lifecycle</h2>
          <ol className="mt-3 flex flex-wrap items-center gap-2">
            {ORDER_STATUSES.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-full border bg-card px-3 py-1.5 text-sm font-semibold">
                  <span className="mr-1 text-muted-foreground tabular-nums">{i + 1}</span>{s}
                </span>
                {i < ORDER_STATUSES.length - 1 && <ArrowRight className="size-4 text-muted-foreground" aria-hidden />}
              </li>
            ))}
          </ol>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            Production cannot start until the customer confirms the specifications. A 30% down payment (or an owner-approved
            exception) is required before dispatch. Delivery is free inside Valencia City; provincial deliveries add a distance fee.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/" variant="default" size="xl">Start the demo <ArrowRight aria-hidden /></LinkButton>
          <LinkButton href="/customer/login" size="xl">Customer portal</LinkButton>
        </div>
        {demo && (
          <p className="mt-4 text-xs text-muted-foreground">
            Demo Mode: all names, addresses and phone numbers (0900-000-xxxx) are fictional sample data.
          </p>
        )}
      </main>
    </div>
  );
}
