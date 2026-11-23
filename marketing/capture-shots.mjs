// Crisp dark-mode screenshots of the real app (Demo Mode, curated dataset) for the poster and booth.
//   (app running: PORT=3100 npm start)   node marketing/capture-shots.mjs
import { createRequire } from "node:module";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = path.resolve(import.meta.dirname, "shots");
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"] });
async function ctx(phone) {
  const c = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, baseURL: BASE } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, baseURL: BASE });
  await c.addInitScript(() => localStorage.setItem("theme", "dark"));
  // hide the Demo-Mode role-switcher strip (demo-only chrome) for marketing shots
  await c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ".bg-demo-bar{display:none!important}"; document.head.appendChild(s); }));
  const p = await c.newPage(); return { c, p };
}
const as = async (p, who) => { await p.goto("/"); await p.getByRole("button", { name: `Enter as ${who}` }).click(); await p.waitForLoadState("networkidle"); };
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

{ const { c, p } = await ctx(); await p.goto("/"); await p.waitForLoadState("networkidle"); await p.waitForTimeout(800); await shot(p, "home");
  await p.goto("/customer/customize"); await p.waitForLoadState("networkidle");
  await p.getByTestId("wood-Mahogany").click(); await p.getByTestId("finish-Walnut Stain").click().catch(() => {});
  await p.evaluate(() => window.scrollTo(0, 230)); await p.waitForTimeout(2500); await shot(p, "configurator");
  const canvas = p.locator("canvas").first(); await canvas.screenshot({ path: `${OUT}/model3d.png` });
  await c.close(); }
{ const { c, p } = await ctx(); await as(p, "Gilbert Decena"); await p.waitForTimeout(800); await shot(p, "staff-queue");
  await p.locator('[data-testid="queue-row"][data-code="JJ-2026-1001"]').click(); const d = p.getByTestId("order-drawer"); await d.getByRole("heading", { name: "JJ-2026-1001" }).waitFor();
  await p.waitForTimeout(1500); await shot(p, "drawer-overview");
  await d.getByRole("tab", { name: "Payments & Gate" }).click(); await p.waitForTimeout(800); await shot(p, "drawer-gate");
  await c.close(); }
{ const { c, p } = await ctx(); await as(p, "Mr. Vincris Lelis"); await p.waitForTimeout(800); await shot(p, "owner"); await c.close(); }
{ const { c, p } = await ctx(true); await as(p, "Nolito Remulta"); await p.waitForTimeout(1200); await shot(p, "craftsman-phone"); await c.close(); }
{ const { c, p } = await ctx(true); await as(p, "Jesse Decena"); await p.getByRole("tab", { name: /Upcoming/ }).click(); await p.waitForTimeout(1200); await shot(p, "driver-phone"); await c.close(); }
{ const { c, p } = await ctx(true); await p.goto("/customer/login"); await p.getByTestId("demo-customer-login").click(); await p.waitForURL(/customer\/orders/); await p.waitForLoadState("networkidle"); await p.waitForTimeout(1500); await shot(p, "customer-phone"); await c.close(); }
await b.close(); console.log("ok");
