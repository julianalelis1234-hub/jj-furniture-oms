import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { isDemoMode } from "@/lib/config";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
/** Serif accent — used ONLY for the "JJ Furniture Shop and Enterprises" wordmark and the hero tagline. */
const serif = Cormorant_Garamond({ variable: "--font-serif", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

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
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <Providers demo={isDemoMode()}>{children}</Providers>
      </body>
    </html>
  );
}
