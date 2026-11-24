import type { Metadata, Viewport } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { isDemoMode } from "@/lib/config";
import "./globals.css";

/** One geometric family for everything: display headings (bold, tight) and body / UI text. No Inter. */
const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"], weight: "variable", display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "JJ Enterprises", template: "%s · JJ Enterprises" },
  description: "Custom furniture orders, quotations and tracking for JJ Enterprises — Furniture and Lumber Dealer, Valencia City, Bukidnon.",
  applicationName: "JJ Enterprises",
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
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <Providers demo={isDemoMode()}>{children}</Providers>
      </body>
    </html>
  );
}
