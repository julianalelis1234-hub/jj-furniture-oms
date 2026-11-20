import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = "http://localhost:3100";
const b = await chromium.launch();

async function persona(name) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE });
  const p = await ctx.newPage();
  await p.goto("/");
  await p.getByRole("button", { name: `Enter as ${name}` }).click();
  await p.waitForLoadState("networkidle");
  return p;
}
async function grab(p) {
  await p.waitForTimeout(500);
  return p.evaluate(() => {
    const body = document.body.cloneNode(true);
    body.querySelectorAll("script, next-route-announcer, nextjs-portal, section[aria-label^='Notifications'], [data-sonner-toaster]").forEach((n) => n.remove());
    // static snapshot: sticky headers would overlap in a tall frame
    body.querySelectorAll("header").forEach((h) => h.classList.remove("sticky"));
    return body.innerHTML;
  });
}
const screens = [];
let p = await persona("Mr. Vincris Lelis"); screens.push(["O-01 Owner Dashboard", await grab(p), false]);
p = await persona("Gilbert Decena"); screens.push(["S-01 Staff · Today's Work", await grab(p), false]);
await p.goto("/staff/new"); await p.waitForLoadState("networkidle"); screens.push(["S-01 Staff · New Order", await grab(p), false]);
p = await persona("Nolito Remulta"); screens.push(["C-01 Craftsmen · Workshop", await grab(p), false]);
p = await persona("Jesse Decena"); await p.getByText("Online • Synced").waitFor(); screens.push(["D-01 Driver · Deliveries", await grab(p), false]);
await p.getByRole("switch", { name: "Simulate Offline / Weak Signal" }).click();
await p.locator("li", { hasText: "JJ-2026-0138" }).getByRole("button", { name: "Start Trip" }).click();
await p.getByText("Offline • Saved Locally (1 pending)").waitFor();
screens.push(["D-01 Driver · Offline (Dark)", await grab(p), true]);
const c = await (await b.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE })).newPage();
await c.goto("/track"); await c.fill("#order_code", "JJ-2026-0145");
await c.getByRole("button", { name: "Check status only" }).click(); await c.getByTestId("track-result").waitFor();
screens.push(["CU-01 Customer · Order ID only", await grab(c), false]);
await c.fill("#pin", "4821"); await c.getByRole("button", { name: "Open with PIN" }).click(); await c.waitForURL(/track\/order/);
await c.waitForLoadState("networkidle");
screens.push(["CU-01 Customer · Verified (PIN)", await grab(c), false]);

// collect CSS + inline fonts
const html0 = await c.content();
const hrefs = [...html0.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
let css = "";
for (const h of [...new Set(hrefs)]) css += await (await fetch(BASE + h)).text();
const fonts = [...new Set([...css.matchAll(/url\((\.\.\/media\/[^)]+)\)/g)].map((m) => m[1]))];
for (const f of fonts) {
  const buf = Buffer.from(await (await fetch(BASE + "/_next/static/" + f.slice(3))).arrayBuffer());
  css = css.split(`url(${f})`).join(`url(data:font/woff2;base64,${buf.toString("base64")})`);
}
const fontVars = await c.evaluate(() => document.documentElement.className);
const doc = `<!doctype html><html lang="en" class="${fontVars}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
html,body{margin:0;background:#d6d3d1}
.board{display:flex;flex-wrap:wrap;gap:48px;padding:48px;align-items:flex-start}
.screen{width:390px;min-height:844px;display:flex;flex-direction:column;background:var(--background);color:var(--foreground);font-family:var(--font-sans),sans-serif;overflow:hidden}
.screen-wrap{display:flex;flex-direction:column;gap:12px}
.screen-label{font:600 20px var(--font-sans),sans-serif;color:#1c1917}
</style></head><body><div class="board">${screens
  .map(([name, inner, dark]) => `<div class="screen-wrap"><div class="screen-label">${name}</div><div class="${dark ? "dark " : ""}screen" data-name="${name}">${inner}</div></div>`)
  .join("")}</div></body></html>`;
writeFileSync("design/portals.html", doc);
console.log("screens", screens.length, "bytes", doc.length, "fonts", fonts.length);
await b.close();
