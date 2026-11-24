import { ArrowRight, LogIn } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/app-shell";
import { DemoBar } from "@/components/demo-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { isDemoMode } from "@/lib/config";
import { demoSwitcherAllowed, getActor, PORTAL_FOR } from "@/lib/server/context";
import { getCustomer } from "@/lib/server/customer-auth";

export const metadata = { title: { absolute: "JJ Enterprises — Furniture and Lumber Dealer" } };

/** Sample work. `preview` marks a 3D configurator render standing in until the shop's photo arrives. */
const SAMPLES = [
  {
    name: "Carved panel door",
    img: "/samples/carved-door.jpg",
    w: 720, h: 960,
    specs: [["Wood", "Solid wood"], ["Finish", "High-gloss dark stain"], ["Size", "Cut to your door frame"]],
    preview: false,
  },
  {
    name: "Dining set",
    img: "/samples/dining-set-3d.jpg",
    w: 895, h: 660,
    specs: [["Wood", "Mahogany"], ["Finish", "Walnut stain"], ["Size", "180 × 76 × 90 cm table"]],
    preview: true,
  },
  {
    name: "Sala set",
    img: "/samples/sala-set-3d.jpg",
    w: 895, h: 660,
    specs: [["Wood", "Mahogany"], ["Finish", "Walnut stain"], ["Size", "180 × 85 × 75 cm sofa"]],
    preview: true,
  },
] as const;

/** Spec tags pinned on the hero photo of the carved door. */
const HOTSPOTS = [
  { top: "18%", left: "36%", text: "Hand-carved S-curve groove" },
  { top: "47%", left: "5%", text: "High-gloss dark stain" },
  { top: "78%", left: "28%", text: "Cut to your door size" },
];

const STEPS = [
  ["Design it in 3D", "Pick the type, size, wood and finish. The 3D model updates as you go, next to a 165 cm figure for true scale."],
  ["We confirm your order", "The shop checks your design and emails you a link to create your account password."],
  ["Get your quotation and pay", "Choose 30% down payment, installment or full payment, by cash, GCash / Maya or bank transfer."],
  ["Follow it to your door", "See every stage, from production and quality inspection to delivery."],
] as const;

export default async function Home() {
  const [actor, customer, switcher] = await Promise.all([getActor(), getCustomer(), demoSwitcherAllowed()]);
  const portal = actor ? PORTAL_FOR[actor.role] : customer ? "/customer/orders" : null;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {switcher && <DemoBar current={actor?.role ?? null} />}

      <header className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-4 sm:px-6">
        <Logo />
        <nav aria-label="Site" className="ml-6 hidden items-center gap-6 text-sm font-semibold md:flex">
          <a href="#sample-work" className="hover:text-primary">Sample work</a>
          <a href="#about" className="hover:text-primary">About us</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link href={portal ?? "/login"} data-testid="landing-login"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
            <LogIn className="size-4" aria-hidden />
            {portal ? "Open my portal" : <>Login{isDemoMode() && <span className="hidden sm:inline">&nbsp;/ Demo access</span>}</>}
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* hero: the oversized headline beside the shop's own carved door */}
        <section aria-labelledby="hero" className="mx-auto grid w-full max-w-7xl items-center gap-10 px-4 pt-6 pb-16 sm:px-6 lg:grid-cols-[1.25fr_0.75fr] lg:pt-10">
          <div>
            <h1 id="hero" className="text-[clamp(3rem,8vw,6.75rem)] leading-[0.94] font-extrabold tracking-[-0.045em]">
              Made to measure, from the lumber up.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Doors, dining sets, sala sets and cabinets built in our Valencia City workshop. Design yours in 3D, get an official quotation, and follow every stage until it reaches your door.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/customer/customize" className="inline-flex h-13 items-center gap-2 rounded-full bg-primary px-7 text-base font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
                Design your piece <ArrowRight className="size-5" aria-hidden />
              </Link>
              <Link href={customer ? "/customer/orders" : "/login"} className="inline-flex h-13 items-center rounded-full border border-foreground/25 px-7 text-base font-bold transition-colors hover:border-foreground/60">
                Track my order
              </Link>
            </div>
          </div>
          <figure className="relative mx-auto w-full max-w-md">
            <Image src="/samples/carved-door.jpg" alt="A solid wood door with a hand-carved S-curve panel and a high-gloss dark stain, in the JJ Enterprises workshop" width={720} height={960} priority
              className="aspect-[3/4] w-full rounded-[2rem] object-cover" />
            {HOTSPOTS.map((h) => (
              <span key={h.text} style={{ top: h.top, left: h.left }} className="absolute flex max-w-[90%] items-center gap-2 rounded-full bg-background/90 py-1.5 pr-3.5 pl-2 text-xs font-semibold whitespace-nowrap text-foreground shadow-sm backdrop-blur">
                <span className="relative flex size-3" aria-hidden><span className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping" /><span className="relative size-3 rounded-full border-2 border-background bg-primary" /></span>
                {h.text}
              </span>
            ))}
          </figure>
        </section>

        {/* sample work */}
        <section id="sample-work" aria-labelledby="sample-title" className="scroll-mt-6 border-t border-border">
          <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 id="sample-title" className="text-4xl sm:text-5xl">Sample work</h2>
              <p className="max-w-md text-muted-foreground">Every piece is built to order. Use these as a starting point, then change the size, wood and finish in the 3D designer.</p>
            </div>
            <ul className="mt-10 grid gap-10 md:grid-cols-3 md:gap-6">
              {SAMPLES.map((s) => (
                <li key={s.name}>
                  {/* 3D renders are landscape: shown whole on Latte, which matches the render's own edge */}
                  <div className={`relative overflow-hidden rounded-[1.5rem] ${s.preview ? "bg-[#E7D6C1]" : "bg-muted"}`}>
                    <Image src={s.img} alt={s.preview ? `3D preview of a ${s.name.toLowerCase()} from the JJ Enterprises designer` : `${s.name} made by JJ Enterprises`} width={s.w} height={s.h}
                      className={`aspect-[4/5] w-full ${s.preview ? "object-contain" : "object-cover"}`} />
                    {s.preview && <span className="absolute bottom-3 left-3 rounded-full bg-[#2B1D17]/85 px-3 py-1 text-xs font-semibold text-[#FAF6F0]">3D preview · photo coming soon</span>}
                  </div>
                  <h3 className="mt-4 text-xl">{s.name}</h3>
                  <dl className="mt-2 divide-y divide-border border-y border-border text-sm">
                    {s.specs.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            <Link href="/customer/customize" className="mt-10 inline-flex items-center gap-2 text-base font-bold underline-offset-4 hover:underline">
              Design one like these <ArrowRight className="size-5" aria-hidden />
            </Link>
          </div>
        </section>

        {/* how ordering works: a real sequence, so it is numbered */}
        <section aria-labelledby="how-title" className="border-t border-border bg-secondary/40">
          <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
            <h2 id="how-title" className="text-4xl sm:text-5xl">How ordering works</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="border-t-2 border-primary pt-4">
                  <span className="text-sm font-bold text-primary tabular-nums">Step {i + 1}</span>
                  <h3 className="mt-1 text-lg">{t}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* about us */}
        <section id="about" aria-labelledby="about-title" className="scroll-mt-6 border-t border-border">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="flex items-start gap-5">
              <Image src="/brand/jj-enterprises-logo.png" alt="" width={812} height={854} className="size-24 shrink-0 object-contain sm:size-28" />
              <h2 id="about-title" className="text-4xl sm:text-5xl">About JJ Enterprises</h2>
            </div>
            <div className="grid max-w-2xl gap-5 text-lg leading-relaxed">
              <p>JJ Enterprises is a furniture and lumber dealer in Poblacion, Valencia City, Bukidnon. We sell lumber, and we build custom furniture from it in our own workshop.</p>
              <p className="text-muted-foreground">Because we work with the wood every day, you choose the timber for your piece, from Mahogany and Gmelina to other local hardwoods, and our craftsmen build it to your measurements. The owner inspects every finished piece before it leaves the shop.</p>
              <dl className="divide-y divide-border border-y border-border text-base">
                {[["Location", "Poblacion, Valencia City, Bukidnon"], ["We make", "Doors, dining sets, sala sets, beds, cabinets and custom pieces"], ["Delivery", "Free within Valencia City; provincial delivery quoted per trip"]].map(([k, v]) => (
                  <div key={k} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-3"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold sm:text-right">{v}</dd></div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>JJ Enterprises — Furniture and Lumber Dealer · Poblacion, Valencia City, Bukidnon</span>
          <span className="ml-auto flex gap-5">
            <a href="#sample-work" className="hover:text-foreground">Sample work</a>
            <a href="#about" className="hover:text-foreground">About us</a>
            <Link href="/login" className="hover:text-foreground">Login</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
