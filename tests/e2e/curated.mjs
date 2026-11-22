// Curated Demo Mode dataset + 3-zone office workspace, against a server started WITHOUT DEMO_DATASET.
//   BASE_URL=http://localhost:3100 node tests/e2e/curated.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const results = []; let failures = 0;
const expect = (c, m) => { if (!c) throw new Error(m); };
async function step(name, fn) { try { await fn(); results.push(`ok   - ${name}`); } catch (e) { failures++; results.push(`FAIL - ${name}\n       ${String(e?.message ?? e).split("\n")[0]}`); } }
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
async function as(name, viewport, theme = "light") {
  const ctx = await browser.newContext({ viewport, baseURL: BASE, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  await page.goto("/"); await page.getByRole("button", { name: `Enter as ${name}` }).click(); await page.waitForLoadState("networkidle");
  return { ctx, page };
}
const noScroll = async (page, label) => { const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); expect(w[0] <= w[1] + 1, `${label}: horizontal scroll ${w}`); };

await step("staff queue shows exactly the 5 curated orders with computed metrics", async () => {
  const { page, ctx } = await as("Gilbert Decena", { width: 1440, height: 1000 });
  await page.goto("/staff");
  const codes = await page.getByTestId("queue-row").evaluateAll((r) => r.map((x) => x.dataset.code).sort());
  expect(codes.join() === "JJ-2026-1001,JJ-2026-1002,JJ-2026-1003,JJ-2026-1004,JJ-2026-1005", `rows ${codes}`);
  const kpi = async (id) => (await page.getByTestId(id).innerText()).replace(/\s+/g, " ");
  expect((await kpi("kpi-needs-quote")).includes(" 2 "), "needs quote 2");
  expect((await kpi("kpi-workshop")).includes(" 2 "), "workshop 2");
  expect((await kpi("kpi-delivery")).includes(" 1 "), "delivery 1");
  expect((await kpi("kpi-deposits")).includes("₱25,000"), "deposits ₱25,000 (verified only)");
  await page.getByTestId("filter-needs_quote").click();
  const nq = await page.getByTestId("queue-row").allInnerTexts();
  expect(nq.length === 1 && nq[0].includes("JJ-2026-1003") && /Intake ·\s*Quote Requested/.test(nq[0]), "Needs Quote = 1003 intake only");
  await page.getByTestId("filter-active").click();
  const bon = await page.locator('[data-testid="queue-row"][data-code="JJ-2026-1005"]').innerText();
  expect(bon.includes("Walk-in · unlinked") && bon.includes("₱19,600") && bon.includes("30% due ₱5,880"), `1005 row: ${bon}`);
  const jul = await page.locator('[data-testid="queue-row"][data-code="JJ-2026-1001"]').innerText();
  expect(jul.includes("Verified account") && jul.includes("₱15,000 (39%)") && jul.includes("balance ₱23,500"), `1001 row: ${jul}`);
  await ctx.close();
});

await step("drawer gates: verified payments only; 30% met / not met per order", async () => {
  const { page, ctx } = await as("Gilbert Decena", { width: 1440, height: 1000 });
  const expectGate = { "JJ-2026-1001": "gate is met", "JJ-2026-1004": "gate is met", "JJ-2026-1002": "₱13,200 more", "JJ-2026-1005": "₱5,880 more", "JJ-2026-1003": "No quotation yet" };
  for (const [code, text] of Object.entries(expectGate)) {
    await page.goto("/staff");
    await page.locator(`[data-testid="queue-row"][data-code="${code}"]`).click();
    const d = page.getByTestId("order-drawer"); await d.getByRole("heading", { name: code }).waitFor();
    if (code === "JJ-2026-1001") {
      expect((await d.innerText()).includes("Timber joinery complete; surface sanding underway"), "workshop sub-detail in the timeline");
      expect((await page.locator("canvas").count()) <= 1, "one 3D renderer at most");
    }
    await d.getByRole("tab", { name: "Payments & Gate" }).click();
    const g = await d.getByTestId("gate-status").innerText();
    expect(g.includes(text), `${code} gate: ${g}`);
  }
  await ctx.close();
});

for (const theme of ["light", "dark"]) {
  await step(`390px ${theme}: stacked list + full-screen sheet, no sideways scroll`, async () => {
    const { page, ctx } = await as("Mr. Vincris Lelis", { width: 390, height: 844 }, theme);
    await page.goto("/owner");
    await page.getByRole("heading", { name: "Shop Overview & Approvals" }).waitFor();
    expect((await page.getByTestId("queue-card").count()) === 5, "5 cards");
    await noScroll(page, "owner list");
    await page.locator('[data-testid="queue-card"][data-code="JJ-2026-1004"]').click();
    const d = page.getByTestId("order-drawer"); await d.getByRole("heading", { name: "JJ-2026-1004" }).waitFor();
    const box = await d.boundingBox();
    expect(box && Math.round(box.width) === 390, `sheet width ${box?.width}`);
    await noScroll(page, "sheet");
    await page.screenshot({ path: `test-results/declutter/curated-${theme}-mobile-sheet.png` });
    await ctx.close();
  });
}

await step("craftsmen and drivers never reach the management workspace", async () => {
  for (const [who, home] of [["Nolito Remulta", "/craftsman"], ["Jesse Decena", "/driver"]]) {
    const { page, ctx } = await as(who, { width: 1280, height: 900 });
    for (const path of ["/staff", "/owner", "/staff?order=x"]) { await page.goto(path); expect(new URL(page.url()).pathname === home, `${who} ${path} → ${page.url()}`); }
    await ctx.close();
  }
});

await step("Demo Customer Login (Juliana Lelis) sees only her own order", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto("/customer/login");
  await page.getByTestId("demo-customer-login").click();
  await page.waitForURL(/customer\/orders/);
  const list = await page.getByTestId("customer-orders").innerText();
  expect(list.includes("JJ-2026-1001") && !/JJ-2026-100[2-5]/.test(list), `dashboard: ${list}`);
  await ctx.close();
});

await browser.close();
console.log(results.join("\n"));
console.log(failures ? `\n${failures} CURATED STEP(S) FAILED` : "\nALL CURATED DEMO CHECKS PASSED");
process.exit(failures ? 1 : 0);
