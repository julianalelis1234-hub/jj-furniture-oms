import { loadFont } from "@remotion/fonts";
import { Easing, staticFile } from "remotion";

/** Smoked Espresso dark palette (matches the app's dark tokens). */
export const C = {
  espresso: "#2B1D17",
  card: "#36251E",
  mocha: "#6B4A3A",
  caramel: "#C48A5A",
  latte: "#E7D6C1",
  cream: "#FAF6F0",
  border: "#4D3E36",
  success: "#7FB77E",
};

export const FPS = 60;
export const W = 1920;
export const H = 1080;
export const TOTAL_SECONDS = 210;
export const TOTAL_FRAMES = TOTAL_SECONDS * FPS; // 12,600

/** The app's typefaces, bundled locally (variable woff2, Latin subset; SIL Open Font License) so renders need no network. */
const font = (family: string, file: string, style = "normal") => {
  loadFont({ family, url: staticFile(`fonts/${file}`), weight: "100 1000", style });
  return `"${family}"`;
};
export const serif = font("EB Garamond", "EBGaramond.woff2");
font("EB Garamond", "EBGaramond-Italic.woff2", "italic");
export const sans = font("Nunito Sans", "NunitoSans.woff2");
export const wordmark = font("Nunito", "Nunito.woff2");

/** The house motion curve: no linear pans, no harsh cuts. */
export const EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const SPRING = { damping: 18, stiffness: 110, mass: 0.9 };

export const sec = (s: number) => Math.round(s * FPS);
export const db = (d: number) => Math.pow(10, d / 20);
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const ease = (x: number) => EASE(clamp01(x));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
