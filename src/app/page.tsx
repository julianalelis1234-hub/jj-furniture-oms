import { ArrowRight, Hammer, PackageSearch, ShieldCheck, Store, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { switchDemoPersona } from "@/app/actions";
import { DemoBar } from "@/components/demo-bar";
import { DesignNote } from "@/components/design-note";
import { Logo } from "@/components/app-shell";
import { LinkButton } from "@/components/link-button";
import { ThemeToggle } from "@/components/theme-toggle";
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
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Logo />
          <div className="ml-auto"><ThemeToggle /></div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Order Monitoring System</h1>
        <p className="mt-2 max-w-2xl text-lg text-muted-foreground">
          Paper slips at the counter, one shared live record for the owner, store, workshop, drivers and customers. Works in any phone browser. Nothing to install.
        </p>

        <LinkButton href="/about" className="mt-4">About this project</LinkButton>

        {actor && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            <p>Signed in as <b>{actor.full_name}</b> ({actor.role}).</p>
            <LinkButton href={PORTAL_FOR[actor.role]} variant="default" className="ml-auto">Continue <ArrowRight aria-hidden /></LinkButton>
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/track" className="group flex items-start gap-4 rounded-2xl border-2 border-primary bg-card p-5 hover:bg-accent sm:col-span-2">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><PackageSearch /></span>
            <span>
              <span className="block text-lg font-bold">Customers: track your order <span className="text-xs font-normal text-muted-foreground">CU-01</span></span>
              <span className="text-muted-foreground">Use the Order ID and 4-digit PIN on your slip. No account needed.</span>
            </span>
            <ArrowRight className="ml-auto self-center transition group-hover:translate-x-1" aria-hidden />
          </Link>

          {demo ? (
            (Object.keys(ROLE_INFO) as Role[]).map((role) => {
              const info = ROLE_INFO[role];
              const people = SEED_PROFILES.filter((p) => p.role === role);
              return (
                <div key={role} className="rounded-2xl border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-secondary [&_svg]:size-5">{info.icon}</span>
                    <div>
                      <p className="font-bold">{info.title} <span className="text-xs font-normal text-muted-foreground">{info.code}</span></p>
                      <p className="text-sm text-muted-foreground">{info.blurb}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {people.map((p) => (
                      <form key={p.id} action={switchDemoPersona.bind(null, p.id)}>
                        <button type="submit" className="h-11 rounded-lg border px-3 text-sm font-semibold hover:border-primary hover:bg-accent">
                          Enter as {p.full_name}
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <Link href="/login" className="flex items-start gap-4 rounded-2xl border bg-card p-5 hover:bg-accent sm:col-span-2">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-secondary"><ShieldCheck /></span>
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
