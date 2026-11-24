import { ArrowRight, Hammer, PackageSearch, ShieldCheck, Store, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { switchDemoPersona } from "@/app/actions";
import { DemoBar } from "@/components/demo-bar";
import { DesignNote } from "@/components/design-note";
import { Eyebrow, IconBadge } from "@/components/eyebrow";
import { Logo } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SwayingTree } from "@/components/ui/SwayingTree";
import { isDemoMode } from "@/lib/config";
import { SEED_PROFILES } from "@/lib/data/seed";
import type { Role } from "@/lib/domain/types";
import { getActor, PORTAL_FOR } from "@/lib/server/context";

const ROLE_INFO: Record<Role, { title: string; code: string; icon: ReactNode; blurb: string }> = {
  owner: { title: "Owner", code: "O-01", icon: <ShieldCheck />, blurb: "KPIs, approvals, inspections and production priority." },
  staff: { title: "Store Assistant", code: "S-01", icon: <Store />, blurb: "Encode paper slips, confirmations, payments and delivery scheduling." },
  craftsman: { title: "Craftsmen", code: "C-01", icon: <Hammer />, blurb: "Priority-sorted job cards. No prices shown." },
  driver: { title: "Delivery Driver", code: "D-01", icon: <Truck />, blurb: "Assigned trips, cash to collect, works offline." },
};

export default async function Home() {
  const demo = isDemoMode();
  const actor = await getActor();
  return (
    <div className="flex min-h-dvh flex-col">
      {demo && <DemoBar current={actor?.role ?? null} />}
      <header className="dark border-b border-border bg-background text-foreground">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Logo />
          <div className="ml-auto"><ThemeToggle /></div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <section className="relative isolate flex flex-col items-center text-center" aria-labelledby="hero-title">
          <div className="jj-hero-glow absolute top-0 left-1/2 -z-10 size-[22rem] -translate-x-1/2 sm:size-[28rem]" aria-hidden />
          <Eyebrow>Custom handcrafted furniture • Valencia City</Eyebrow>
          <SwayingTree className="mt-5 h-36 w-32 sm:h-44 sm:w-40" />
          <p className="mt-2 font-serif text-lg tracking-[0.28em] text-muted-foreground lowercase italic sm:text-xl">modern • warm • luxurious</p>
          <p className="mt-4 font-serif text-2xl font-semibold sm:text-3xl">JJ Enterprises — Furniture and Lumber Dealer</p>
          <h1 id="hero-title" className="mt-1 text-4xl font-semibold text-balance sm:text-5xl">Order Monitoring System</h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Paper slips at the counter, one shared live record for the owner, store, workshop, drivers and customers. Works in any phone browser. Nothing to install.
          </p>
          <LinkButton href="/about" variant="outline" className="mt-5">About this project</LinkButton>
        </section>

        {actor && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            <p>Signed in as <b>{actor.full_name}</b> ({actor.role}).</p>
            <LinkButton href={PORTAL_FOR[actor.role]} variant="default" className="ml-auto">Continue <ArrowRight aria-hidden /></LinkButton>
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/customer/login" className="jj-surface group flex items-start gap-4 rounded-2xl border border-live bg-card p-5 transition-shadow hover:shadow-(--shadow-glow) sm:col-span-2">
            <IconBadge className="size-12"><PackageSearch /></IconBadge>
            <span>
              <span className="block text-lg font-bold">Customers: log in to track your orders <span className="text-xs font-normal text-muted-foreground">CU-01</span></span>
              <span className="text-muted-foreground">Log in with your email and password — or customize a piece and request a quote.</span>
            </span>
            <ArrowRight className="ml-auto self-center transition group-hover:translate-x-1" aria-hidden />
          </Link>

          {demo ? (
            (Object.keys(ROLE_INFO) as Role[]).map((role) => {
              const info = ROLE_INFO[role];
              const people = SEED_PROFILES.filter((p) => p.role === role);
              return (
                <div key={role} className="jj-surface rounded-2xl border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <IconBadge>{info.icon}</IconBadge>
                    <div>
                      <p className="font-bold">{info.title} <span className="text-xs font-normal text-muted-foreground">{info.code}</span></p>
                      <p className="text-sm text-muted-foreground">{info.blurb}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {people.map((p) => (
                      <form key={p.id} action={switchDemoPersona.bind(null, p.id)}>
                        <button type="submit" className="h-11 rounded-full border border-primary/60 bg-background px-4 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-accent-soft">
                          Enter as {p.full_name}
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <Link href="/login" className="flex items-start gap-4 rounded-2xl border bg-card p-5 hover:bg-accent-soft sm:col-span-2">
              <IconBadge className="size-12"><ShieldCheck /></IconBadge>
              <span>
                <span className="block text-lg font-bold">Shop staff sign in</span>
                <span className="text-muted-foreground">Owner, store assistants, craftsmen and drivers.</span>
              </span>
            </Link>
          )}
        </div>
        {demo && (
          <DesignNote className="mt-6">
            Demo Mode is for HCI usability testing with realistic Valencia City sample records. In production (NEXT_PUBLIC_APP_MODE=production) this page shows only staff sign-in and customer tracking, and roles come from Supabase Auth plus the profiles table.
          </DesignNote>
        )}
      </main>
    </div>
  );
}
