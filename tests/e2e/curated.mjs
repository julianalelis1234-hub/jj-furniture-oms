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
const ACCOUNT = { "Gilbert Decena": "Staff", "Mr. Vincris Lelis": "Owner", "Nolito Remulta": "Craftsman", "Jesse Decena": "Delivery Rider" };
async function as(name, viewport, theme = "light") {
  const ctx = await browser.newContext({ viewport, baseURL: BASE, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  await page.goto("/login"); await page.getByRole("button", { name: `Sign in as ${ACCOUNT[name]}` }).click(); await page.waitForLoadState("networkidle");
  return { ctx, page };
}
const noScroll = async (page, label) => { const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); expect(w[0] <= w[1] + 1, `${label}: horizontal scroll ${w}`); };

await step("staff queue shows exactly the 5 curated orders with computed metrics", async () => {
  const { page, ctx } = await as("Gilbert Decena", { width: 1440, height: 1000 });
  await page.goto("/staff");
  const codes = await page.getByTestId("queue-row").evaluateAll((r) => r.map((x) => x.dataset.code).sort());
  expect(codes.join() === "JJ-2026-1001,JJ-2026-1002,JJ-2026-1003,JJ-2026-1004,JJ-2026-1005", `rows ${codes}`);
  const kpi = async (id) => (await page.getByTestId(id).innerText()).replace(/\s+/g, " ");
  expect((await kpi("kpi-to-confirm")).includes(" 1 "), "to confirm 1");
  expect((await kpi("kpi-quote-payment")).includes(" 2 "), "quotation & payment 2");
  expect((await kpi("kpi-workshop")).includes(" 1 "), "workshop 1");
  expect((await kpi("kpi-delivery")).includes(" 1 "), "delivery 1");
  expect((await kpi("kpi-deposits")).includes("₱25,000"), "deposits ₱25,000 (verified only)");
  await page.getByTestId("filter-to_confirm").click();
  const nq = await page.getByTestId("queue-row").allInnerTexts();
  expect(nq.length === 1 && nq[0].includes("JJ-2026-1003") && /Waiting/.test(nq[0]), `To confirm = the 1003 online order only: ${nq}`);
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
    await page.goto("/owner/orders");
    await page.getByRole("heading", { level: 1, name: "Orders & Quotations" }).waitFor();
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
  // In Production: the customer sees the production lock, and no quotation to accept
  await page.goto("/customer/orders/JJ-2026-1001");
  await page.getByTestId("spec-locked").waitFor();
  expect((await page.getByTestId("accept-quotation").count()) === 0, "nothing to accept once production started");
  await ctx.close();
});

await step("Rea Caday creates her password from the confirmation email, accepts JJ-2026-1002 with 30% down, and sends a bank transfer", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/demo/inbox");
  const item = page.getByTestId("inbox-item").filter({ hasText: "rea.caday@example.com" }).filter({ has: page.locator('a[href^="/customer/set-password"]') }).first();
  await page.goto(await item.locator('a[href^="/customer/set-password"]').first().getAttribute("href"));
  await page.waitForLoadState("networkidle");
  await page.fill("#password", "Mahogany-Bed-2026");
  await page.fill("#confirm", "Mahogany-Bed-2026");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL(/\/customer\/orders/);
  expect((await page.getByTestId("customer-orders").innerText()).includes("JJ-2026-1002"), "Rea sees her order");
  await page.goto("/customer/orders/JJ-2026-1002");
  const accept = page.getByTestId("accept-quotation");
  await accept.waitFor();
  expect((await accept.innerText()).includes("₱13,200"), "30% down payment shown before accepting");
  await accept.getByText("Bank transfer").click();
  await accept.getByText("I checked the design").click();
  await accept.getByText("I accept the quotation").click();
  await accept.getByRole("button", { name: "Accept quotation" }).click();
  await page.getByText("Quotation accepted.").first().waitFor();
  const pay = page.getByTestId("submit-payment");
  await pay.waitFor();
  expect((await pay.locator("#amount").inputValue()) === "13200", "the amount defaults to the 30% down payment");
  await pay.locator("#reference_number").fill("BDO 2026 1124 0001");
  await pay.locator("#proof").setInputFiles({ name: "deposit-slip.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") });
  await pay.getByRole("button", { name: "Send payment for checking" }).click();
  await page.getByText("Payment sent.").first().waitFor();
  await noScroll(page, "customer-pay-mobile");
  await page.screenshot({ path: "test-results/declutter/curated-customer-pay-mobile.png", fullPage: true });
  await ctx.close();
});

await step("six demo accounts: wrong password refused; fixed role accounts get no role switcher; Demo account does", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto("/login");
  expect((await page.getByTestId("demo-accounts").locator("button").count()) === 6, "six demo accounts listed");
  await page.fill("#email", "owner@jj-enterprises.example"); await page.fill("#password", "wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").getByText("Wrong email or password.").waitFor();
  for (const [label, path] of [["Owner", "/owner"], ["Staff", "/staff"], ["Craftsman", "/craftsman"], ["Delivery Rider", "/driver"]]) {
    await page.goto("/login"); await page.getByRole("button", { name: `Sign in as ${label}` }).click();
    await page.waitForURL((u) => u.pathname === path);
    expect((await page.getByRole("navigation", { name: "Switch demo role" }).count()) === 0, `${label}: no role switcher`);
    await page.getByRole("button", { name: /Exit|Sign out/ }).first().click(); await page.waitForURL((u) => u.pathname === "/");
  }
  await page.goto("/login"); await page.getByRole("button", { name: "Sign in as Customer" }).click();
  await page.waitForURL(/\/customer\/orders/);
  expect((await page.getByTestId("customer-orders").innerText()).includes("JJ-2026-1001"), "customer account opens its orders");
  await page.goto("/login"); await page.getByRole("button", { name: "Sign in as Demo (all roles)" }).click();
  await page.waitForURL(/\/owner/);
  const bar = page.getByRole("navigation", { name: "Switch demo role" });
  await bar.getByRole("button", { name: /^Staff/ }).click(); await page.waitForURL(/\/staff/);
  await bar.getByRole("button", { name: /^Delivery Rider/ }).click(); await page.waitForURL(/\/driver/);
  await bar.getByRole("button", { name: /^Customer/ }).click(); await page.waitForURL(/\/customer\/orders/);
  expect((await bar.count()) === 1, "switcher stays on the customer portal for the Demo account");
  await ctx.close();
});

await step("all six demo accounts on desktop (1440) and phone (390): right portal, own content, no sideways scroll, phone nav, no access elsewhere", async () => {
  const ACCOUNTS = [
    { label: "Demo (all roles)", home: /^\/owner$/, anchor: (p) => p.getByRole("navigation", { name: "Switch demo role" }), nav: true },
    { label: "Owner", home: /^\/owner$/, anchor: (p) => p.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), / }), nav: true, denied: ["/craftsman", "/driver"] },
    { label: "Staff", home: /^\/staff$/, anchor: (p) => p.getByRole("heading", { name: "Operations & Order Queue" }), nav: true, denied: ["/owner", "/owner/inventory", "/craftsman"] },
    { label: "Craftsman", home: /^\/craftsman$/, anchor: (p) => p.getByRole("tablist", { name: "Job status" }), nav: false, denied: ["/owner", "/staff", "/driver"] },
    { label: "Delivery Rider", home: /^\/driver$/, anchor: (p) => p.getByText("Online • Synced"), nav: false, denied: ["/owner", "/staff", "/craftsman"] },
    { label: "Customer", home: /^\/customer\/orders$/, anchor: (p) => p.getByTestId("customer-orders"), nav: true, denied: ["/owner", "/staff", "/owner/inventory"] },
  ];
  for (const vp of [{ width: 1440, height: 900, name: "desktop" }, { width: 390, height: 844, name: "phone" }]) {
    for (const a of ACCOUNTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, baseURL: BASE, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/login");
      await page.getByRole("button", { name: `Sign in as ${a.label}` }).click();
      await page.waitForURL((u) => a.home.test(u.pathname), { timeout: 15000 });
      await a.anchor(page).first().waitFor({ timeout: 15000 });
      await page.waitForLoadState("networkidle");
      await noScroll(page, `${a.label} ${vp.name}`);
      const navShown = await page.getByTestId("mobile-nav-action").isVisible().catch(() => false);
      if (vp.name === "phone") expect(navShown === a.nav, `${a.label}: phone bottom nav ${a.nav ? "shown" : "hidden"} (got ${navShown})`);
      else expect(!navShown, `${a.label}: no bottom nav on desktop`);
      await page.screenshot({ path: `test-results/accounts/${vp.name}-${a.label.replace(/[^a-z]+/gi, "-").toLowerCase()}.png` });
      for (const path of a.denied ?? []) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(new URL(page.url()).pathname !== path, `${a.label} must not open ${path} (got ${page.url()})`);
      }
      expect(errors.length === 0, `${a.label} ${vp.name}: page errors ${errors.join(" | ")}`);
      await ctx.close();
    }
  }
});

await step("Demo Inbox: the curated emails are readable, link to the right pages, and never contain a password", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE }); const page = await ctx.newPage();
  await page.goto("/demo/inbox");
  const items = page.getByTestId("inbox-item");
  expect((await items.count()) >= 2, "emails listed");
  const rea = items.filter({ hasText: "rea.caday@example.com" });
  const text = (await rea.allInnerTexts()).join("\n");
  expect(/create your JJ Enterprises password/.test(text) && /choose how to pay/.test(text), "Rea's confirmation and quotation emails");
  expect(!/temporary password|your password is|password\s*:/i.test(text), "no password in any email");
  expect((await rea.locator('a[href^="/customer/set-password?token="]').count()) === 1, "one single-use create-password link");
  expect((await rea.locator('a[href="/customer/orders/JJ-2026-1002"]').count()) === 1, "the quotation email links to the login-protected order page");
  await noScroll(page, "demo inbox phone");
  await page.screenshot({ path: "test-results/accounts/demo-inbox-phone.png", fullPage: true });
  await ctx.close();
});

await step("landing page: sample work + about us, login button, no testimonials, no horizontal scroll at 390px", async () => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, baseURL: BASE }); const page = await ctx.newPage();
    await page.goto("/");
    await page.getByRole("heading", { name: "Sample work" }).waitFor();
    await page.getByRole("heading", { name: "About JJ Enterprises" }).waitFor();
    expect(!(await page.content()).toLowerCase().includes("testimonial"), "no testimonials");
    await noScroll(page, `landing ${vp.width}`);
    await page.getByTestId("landing-login").click(); await page.waitForURL(/\/login/);
    await ctx.close();
  }
});

await browser.close();
console.log(results.join("\n"));
console.log(failures ? `\n${failures} CURATED STEP(S) FAILED` : "\nALL CURATED DEMO CHECKS PASSED");
process.exit(failures ? 1 : 0);
