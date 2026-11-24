import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { SHOP_TZ } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";

/** Shared building blocks of the portal dashboards (one layout for every role). */

export const dashCard = "rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgb(43_29_23/0.04)]";

export function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: SHOP_TZ }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
export const firstName = (full: string) => full.replace(/^(mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0] ?? full;
export const longToday = (now: Date) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: SHOP_TZ }).format(now);

/** "Good evening, Name" + date line + the page's primary actions on the right. */
export function DashboardHeader({ name, now, summary, actions }: { name: string; now: Date; summary?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-3 sm:mb-4 sm:mb-6 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="text-xl font-bold tracking-[-0.02em] sm:text-3xl">{greeting(now)}, {firstName(name)}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">{longToday(now)}{summary ? <> · {summary}</> : null}</p>
      </div>
      {actions}
    </header>
  );
}

/** A KPI card: label, icon chip, big number, one supporting line. */
export function KpiCard({ testid, label, value, sub, icon, tone = "muted" }: {
  testid?: string; label: string; value: ReactNode; sub: ReactNode; icon: ReactNode; tone?: "good" | "warning" | "muted";
}) {
  return (
    <div className={cn(dashCard, "flex min-w-0 flex-col gap-1.5 p-3 sm:gap-3 sm:p-5")} data-testid={testid}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold text-muted-foreground sm:text-sm">{label}</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-primary sm:size-9 sm:rounded-xl [&_svg]:size-3.5 sm:[&_svg]:size-4" aria-hidden>{icon}</span>
      </div>
      <span className="truncate text-xl leading-none font-extrabold tracking-[-0.03em] tabular-nums sm:text-[2rem]">{value}</span>
      <span className={cn("flex items-center gap-1 text-[11px] leading-snug font-semibold sm:text-xs", tone === "good" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground")}>{sub}</span>
    </div>
  );
}

export function KpiRow({ children, testid, cols = 4 }: { children: ReactNode; testid?: string; cols?: 4 | 5 }) {
  return <div className={cn("mb-3 grid grid-cols-2 gap-2.5 sm:mb-5 sm:gap-4", cols === 5 ? "lg:grid-cols-3 xl:grid-cols-5" : "xl:grid-cols-4")} data-testid={testid}>{children}</div>;
}

/** The espresso highlight card (right column): a glow, a title row with a chip, then its content. */
export function DarkCard({ id, title, chip = "Live", children, className }: { id: string; title: string; chip?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("dark relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 sm:gap-4 bg-[#1e130e] bg-[radial-gradient(22rem_18rem_at_100%_0%,rgb(196_138_90/0.38),transparent_70%)] premium:border-[#d4af6a]/25 premium:bg-[#121212] premium:bg-[radial-gradient(22rem_18rem_at_100%_0%,rgb(212_175_106/0.28),transparent_70%)] p-3.5 sm:p-5 text-[#faf6f0] shadow-[0_12px_32px_-12px_rgb(30_19_14/0.55)]", className)}>
      <div className="relative flex items-center gap-2">
        <Sparkles className="size-4 text-[#f0b27a] premium:text-[#e9cf98]" aria-hidden />
        <h2 id={id} className="flex-1 text-sm font-bold">{title}</h2>
        {chip && <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">{chip}</span>}
      </div>
      <div className="relative flex flex-1 flex-col gap-3 sm:gap-4">{children}</div>
    </section>
  );
}

/** Big number + caption, used at the top of the dark card. */
export function DarkFigure({ value, caption, note, noteTone = "good", testid }: { value: ReactNode; caption: string; note?: ReactNode; noteTone?: "good" | "warning"; testid?: string }) {
  return (
    <div>
      <p className="flex items-baseline gap-2"><b className="text-4xl sm:text-5xl leading-none font-extrabold tracking-[-0.03em] tabular-nums">{value}</b><span className="text-xs text-white/75 sm:text-sm">{caption}</span></p>
      {note && <p className={cn("mt-1 text-xs font-semibold", noteTone === "warning" ? "text-[#f3c77a]" : "text-[#9fd3a4]")} data-testid={testid}>{note}</p>}
    </div>
  );
}

/** Up to three small figures on the dark card. */
export function DarkStats({ items }: { items: { label: string; value: ReactNode; testid?: string }[] }) {
  return (
    <dl className={cn("grid gap-2 text-center", items.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
      {items.map((s) => (
        <div key={s.label} data-testid={s.testid} className="rounded-lg bg-white/[0.07] px-1.5 py-1.5 sm:rounded-xl sm:px-2 sm:py-2">
          <dt className="text-[10px] text-white/65 sm:text-[11px]">{s.label}</dt>
          <dd className="text-base font-extrabold tabular-nums sm:text-lg">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const darkPrimary = "inline-flex h-10 sm:h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#a86a3e] to-[#c48a5a] premium:from-[#b8924f] premium:to-[#e2c283] premium:text-[#111] px-3 text-[13px] font-bold sm:px-4 sm:text-sm text-white hover:brightness-110";
export const darkSecondary = "inline-flex h-10 sm:h-11 items-center justify-center rounded-full bg-white/10 px-3 text-[13px] font-semibold sm:px-4 sm:text-sm hover:bg-white/15";
export const headerPrimary = "inline-flex h-10 sm:h-11 items-center gap-2 rounded-xl bg-primary px-3 text-[13px] font-bold sm:px-4 sm:text-sm text-primary-foreground hover:bg-primary/90";
export const headerSecondary = "inline-flex h-10 sm:h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[13px] font-semibold sm:px-4 sm:text-sm hover:bg-muted";

/** A white card section with a title row (title, optional chip, optional link on the right). */
export function CardSection({ id, title, chip, action, children, className, testid }: {
  id: string; title: ReactNode; chip?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testid?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn(dashCard, "mb-3 sm:mb-5 scroll-mt-6 p-3.5 sm:p-5", className)} data-testid={testid}>
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-3">
        <h2 id={`${id}-title`} className="text-base font-bold sm:text-lg">{title}</h2>
        {chip && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-primary sm:px-2.5 sm:py-1 sm:text-xs">
            <Sparkles className="size-3.5" aria-hidden /> {chip}
          </span>
        )}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A person row as a small card: initials avatar, name, a line under it, and chips on the right. */
export function PersonCard({ name, line, chips, className }: { name: string; line?: ReactNode; chips?: ReactNode; className?: string }) {
  const ini = name.replace(/^(mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <li className={cn("flex min-w-0 items-center gap-3 rounded-xl border border-border bg-muted/40 p-2.5 sm:p-3", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground sm:size-10 sm:text-sm" aria-hidden>{ini}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-sm sm:text-base">{name}</b>
        {line && <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">{line}</span>}
      </span>
      {chips && <span className="flex shrink-0 flex-wrap justify-end gap-1">{chips}</span>}
    </li>
  );
}

export const chip = "rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold tabular-nums sm:px-2.5 sm:text-xs";

/** Section page heading (every portal): title, one line, actions on the right. */
export function PageHeading({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-3">
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="text-xl font-bold tracking-[-0.02em] sm:text-3xl">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
