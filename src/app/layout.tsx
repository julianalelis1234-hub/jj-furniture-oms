import type { Metadata, Viewport } from "next";
import { EB_Garamond, Geist_Mono, Nunito, Nunito_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { isDemoMode } from "@/lib/config";
import "./globals.css";

/** Body, buttons, forms, card titles: clean humanist sans. */
const sans = Nunito_Sans({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
/** Display serif: page / section headings, uppercase eyebrow labels, hero lines. */
const serif = EB_Garamond({ variable: "--font-serif", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
/** Rounded sans for the JJ Furniture wordmark only. */
const brand = Nunito({ variable: "--font-brand", subsets: ["latin"], weight: ["700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "JJ Furniture OMS", template: "%s · JJ Furniture OMS" },
  description: "Hybrid order monitoring for JJ Furniture Shop and Enterprises, Valencia City, Bukidnon.",
  applicationName: "JJ Furniture OMS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6f0" },
    { media: "(prefers-color-scheme: dark)", color: "#2b1d17" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable} ${brand.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <Providers demo={isDemoMode()}>{children}</Providers>
      </body>
    </html>
  );
}
