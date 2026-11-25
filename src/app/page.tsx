import { ArrowRight, LogIn, PencilRuler } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/app-shell";
import { CardSection, DarkCard, darkPrimary, darkSecondary, dashCard } from "@/components/dashboard";
import { DemoBar } from "@/components/demo-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { isDemoMode } from "@/lib/config";
import { demoSwitcherAllowed, getActor, PORTAL_FOR } from "@/lib/server/context";
import { getCustomerSafe } from "@/lib/server/customer-auth";
import { cn } from "@/lib/utils";

export const metadata = { title: { absolute: "JJ Enterprises — Furniture and Lumber Dealer" } };

/** Sample work: the shop's own photos. `preview` marks a 3D configurator render standing in until the shop's photo arrives. */
const SAMPLES = [
  { name: "Glass-top dining set", img: "/samples/dining-set-glass-top.jpg", w: 960, h: 960, line: "Slatted high-back chairs · red-brown stain", kind: "Dining" },
  { name: "10-seater dining set", img: "/samples/dining-set-10-seater.jpg", w: 787, h: 1400, line: "Solid wood slab table · natural finish", kind: "Dining" },
  { name: "Carved panel door", img: "/samples/carved-door.jpg", w: 720, h: 960, line: "Hand-carved S-curve · high-gloss dark stain", kind: "Doors" },
  { name: "Panel doors", img: "/samples/panel-doors-trio.jpg", w: 720, h: 960, line: "Raised panels · mahogany, black and arch designs", kind: "Doors" },
  { name: "Coffered door", img: "/samples/coffered-door.jpg", w: 720, h: 960, line: "Square coffered panels · dark walnut gloss", kind: "Doors" },
  { name: "Dining set, side view", img: "/samples/dining-set-10-seater-side.jpg", w: 787, h: 1400, line: "Slatted chairs cut from the same timber", kind: "Dining" },
  { name: "Sala set", img: "/samples/sala-set-3d.jpg", w: 895, h: 660, line: "Mahogany · walnut stain", kind: "3D preview", preview: true },
] as const;

/** Spec tags pinned on the hero photo of the carved door (wider screens only). */
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
  // a signed-in staff member is never also a customer: skip the customer lookup for them
  const [actor, switcher] = await Promise.all([getActor(), demoSwitcherAllowed()]);
  const customer = actor ? null : await getCustomerSafe();
  const portal = actor ? PORTAL_FOR[actor.role] : customer ? "/customer/orders" : null;
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      {switcher && <DemoBar current={actor?.role ?? null} />}

      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-3 py-2 sm:gap-4 sm:px-6 sm:py-3 max-sm:[&_img]:size-8">
          <Logo compact />
          <nav aria-label="Site" className="ml-6 hidden items-center gap-6 text-sm font-semibold md:flex">
            <a href="#sample-work" className="hover:text-primary">Sample work</a>
            <a href="#how" className="hover:text-primary">How ordering works</a>
            <a href="#about" className="hover:text-primary">About us</a>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <Link href={portal ?? "/login"} data-testid="landing-login"
              className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-primary px-3 text-[13px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:h-11 sm:px-4 sm:text-sm">
              <LogIn className={cn("size-4", portal && "max-sm:hidden")} aria-hidden />
              {portal ? <><span className="sm:hidden">Portal</span><span className="hidden sm:inline">Open my portal</span></> : <>Login{isDemoMode() && <span className="hidden sm:inline">&nbsp;/ Demo access</span>}</>}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pt-3 pb-10 sm:px-6 sm:pt-6">
        {/* hero: headline card beside the shop's own carved door */}
        <section aria-labelledby="hero" className="mb-3 grid gap-3 sm:mb-5 sm:gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div className={cn(dashCard, "flex flex-col justify-center p-5 sm:p-10")}>
            <h1 id="hero" className="text-[clamp(2.1rem,6.5vw,5.25rem)] leading-[0.95] font-extrabold tracking-[-0.045em]">
              Made to measure, from the lumber up.
            </h1>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:mt-5 sm:text-lg">
              Doors, dining sets, sala sets and cabinets built in our Valencia City workshop. Design yours in 3D, get an official quotation, and follow every stage until it reaches your door.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 sm:mt-8 sm:gap-3">
              <Link href="/customer/customize" className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:h-12 sm:px-6 sm:text-base">
                <PencilRuler className="size-4" aria-hidden /> Design your piece
              </Link>
              <Link href={customer ? "/customer/orders" : "/login"} className="inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-muted sm:h-12 sm:px-6 sm:text-base">
                Track my order
              </Link>
            </div>
          </div>
          {/* phones: a short landscape crop; wider screens: the full portrait photo with spec tags */}
          <figure className={cn(dashCard, "relative overflow-hidden p-0")}>
            <Image src="/samples/carved-door.jpg" alt="A solid wood door with a hand-carved S-curve panel and a high-gloss dark stain, in the JJ Enterprises workshop" width={720} height={960} priority
              sizes="(min-width: 1024px) 34vw, 100vw"
              className="aspect-[16/9] w-full object-cover object-[50%_35%] sm:aspect-[4/3] lg:aspect-auto lg:h-full" />
            {HOTSPOTS.map((h) => (
              <span key={h.text} style={{ top: h.top, left: h.left }} className="absolute hidden max-w-[90%] items-center gap-2 rounded-full bg-background/90 py-1.5 pr-3.5 pl-2 text-xs font-semibold whitespace-nowrap text-foreground shadow-sm backdrop-blur lg:flex">
                <span className="relative flex size-3" aria-hidden><span className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping" /><span className="relative size-3 rounded-full border-2 border-background bg-primary" /></span>
                {h.text}
              </span>
            ))}
            <figcaption className="absolute bottom-2 left-2 rounded-full bg-[#2B1D17]/80 px-2.5 py-1 text-[11px] font-semibold text-[#FAF6F0] lg:hidden">Carved panel door · our workshop</figcaption>
          </figure>
        </section>

        {/* sample work: a swipeable strip on phones, a grid on wider screens */}
        <CardSection id="sample-work" title="Sample work" chip="Real photos from our shop"
          action={<Link href="/customer/customize" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">Design one</Link>}>
          <p className="mb-3 max-w-2xl text-xs text-muted-foreground sm:mb-4 sm:text-sm">Every piece is built to order. Use these as a starting point, then change the size, wood and finish in the 3D designer.</p>
          <ul className="-mx-3.5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-3.5 pb-2 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0"
            aria-label="Sample work photos">
            {SAMPLES.map((s, i) => {
              const preview = "preview" in s && s.preview;
              const featured = i === 0; // wide tile on tablets and up, so seven photos fill two even rows
              return (
                <li key={s.img} className={cn("w-36 shrink-0 snap-start sm:w-auto", featured && "sm:col-span-2")}>
                  <div className={cn("relative overflow-hidden rounded-xl", preview ? "bg-[#E7D6C1]" : "bg-muted")}>
                    <Image src={s.img} alt={preview ? `3D preview of a ${s.name.toLowerCase()} from the JJ Enterprises designer` : `${s.name} made by JJ Enterprises`}
                      width={s.w} height={s.h} sizes={featured ? "(min-width: 640px) 46vw, 144px" : "(min-width: 640px) 22vw, 144px"}
                      className={cn("aspect-[4/5] w-full", featured && "sm:aspect-[7/4] sm:object-[50%_45%]", preview ? "object-contain" : "object-cover")} />
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-[#2B1D17]/80 px-2 py-0.5 text-[10px] font-semibold text-[#FAF6F0] sm:top-2 sm:left-2 sm:text-[11px]">
                      {preview ? "3D preview · photo coming soon" : s.kind}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm leading-tight font-bold sm:text-base">{s.name}</h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">{s.line}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground sm:hidden" aria-hidden>Swipe for more →</p>
        </CardSection>

        {/* how ordering works: a real sequence, so it is numbered */}
        <CardSection id="how" title="How ordering works">
          <ol className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="rounded-xl bg-muted/50 p-3 sm:p-4">
                <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums sm:size-8 sm:text-sm">{i + 1}</span>
                <h3 className="mt-2 text-sm leading-tight font-bold sm:text-base">{t}</h3>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-sm">{d}</p>
              </li>
            ))}
          </ol>
        </CardSection>

        {/* about us: white card + the dark highlight card */}
        <div className="grid gap-3 sm:gap-5 lg:grid-cols-2">
          <section id="about" aria-labelledby="about-title" className={cn(dashCard, "scroll-mt-20 p-3.5 sm:p-6")}>
            <div className="mb-3 flex items-center gap-3 sm:mb-4">
              <Image src="/brand/jj-enterprises-logo.png" alt="" width={812} height={854} className="size-12 shrink-0 object-contain sm:size-16" />
              <h2 id="about-title" className="text-xl font-bold sm:text-3xl">About JJ Enterprises</h2>
            </div>
            <div className="grid max-w-2xl gap-3 text-sm leading-relaxed sm:text-base">
              <p>JJ Enterprises is a furniture and lumber dealer in Poblacion, Valencia City, Bukidnon. We sell lumber, and we build custom furniture from it in our own workshop.</p>
              <p className="text-muted-foreground">Because we work with the wood every day, you choose the timber for your piece, from Mahogany and Gmelina to other local hardwoods, and our craftsmen build it to your measurements. The owner inspects every finished piece before it leaves the shop.</p>
            </div>
          </section>
          <DarkCard id="visit-title" title="Visit or order online" chip="">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {[["Location", "Poblacion, Valencia City, Bukidnon"], ["We make", "Doors, dining sets, sala sets, beds, cabinets and custom pieces"], ["Delivery", "Free within Valencia City; provincial delivery quoted per trip"], ["Payment", "Cash, GCash / Maya or bank transfer"]].map(([k, v]) => (
                <p key={k} className="rounded-xl bg-white/[0.07] p-2.5 sm:p-3"><span className="block text-[11px] text-white/65">{k}</span><b className="font-semibold">{v}</b></p>
              ))}
            </div>
            <div className="mt-auto flex gap-2">
              <Link href="/customer/customize" className={darkPrimary}>Design your piece <ArrowRight className="size-4" aria-hidden /></Link>
              <Link href={customer ? "/customer/orders" : "/login"} className={darkSecondary}>Track</Link>
            </div>
          </DarkCard>
        </div>
      </main>

      <footer className="border-t border-border bg-background/60">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-3 py-5 text-xs text-muted-foreground sm:px-6 sm:text-sm">
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
