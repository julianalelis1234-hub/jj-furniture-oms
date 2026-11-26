// Full-screen 3D turntable of the demo chest, recorded in slow motion for a smooth hero shot.
//
// SwiftShader renders a full-screen WebGL canvas at only ~7 fps, so the page's clock
// (performance.now / Date.now / rAF timestamps, which drive the turntable) is slowed to
// 1/SLOW speed while recording; the editor plays the clip back SLOW× faster. Only the
// recording's timing changes: the app and its 3D model are untouched.
//
//   node video/capture/capture-3d-slowmo.mjs   (app running on BASE_URL, default :3100)
import { chromium, Recorder } from "./recorder.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
export const SLOW = 4;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, baseURL: BASE });
  await ctx.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    const z = () => { document.documentElement.style.zoom = String(4 / 3); };
    z(); document.addEventListener("DOMContentLoaded", z);
  });
  const page = await ctx.newPage();
  await page.goto("/customer/login"); await page.getByTestId("option-2").click();
  await page.waitForURL(/\/customer\/customize/); await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
  // the same design as the demo: AI sentence, then one more drawer and Walnut Stain
  await page.fill("#assistant-text", "Chest of drawers with 6 drawers, narra, dark espresso finish, 90 x 120 x 45 cm");
  await page.getByTestId("assistant-apply").click();
  await page.getByTestId("preview-updated").first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByTestId("opt-drawers-plus").click();
  await page.getByTestId("finish-Walnut Stain").click();
  await page.waitForTimeout(800);
  await page.getByTestId("ar-open").first().click();
  await page.getByTestId("ar-viewer").waitFor(); await page.waitForTimeout(3000);
  // slow the page clock (continuous: time keeps going from "now", just slower)
  await page.evaluate((k) => {
    const realPerf = performance.now.bind(performance);
    const p0 = realPerf();
    performance.now = () => p0 + (realPerf() - p0) / k;
    const realDate = Date.now;
    const d0 = realDate();
    Date.now = () => d0 + (realDate() - d0) / k;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => cb(p0 + (t - p0) / k));
  }, SLOW);
  await page.waitForTimeout(500);
  const rec = new Recorder(page, "d60-3d"); await rec.start();
  rec.mark("slowmo", { factor: SLOW });
  await page.waitForTimeout(40_000); // = 10 s of real turntable time
  const meta = await rec.stop();
  console.log(meta.name, meta.duration, (meta.frames / meta.duration).toFixed(1), "fps captured");
} finally {
  await browser.close();
}
