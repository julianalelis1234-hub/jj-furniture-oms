// End-to-end smoke test of all five portals against a running server (demo mode, in-memory data).
//   BASE_URL=http://localhost:3100 node tests/e2e/run.mjs
// Uses the system Playwright; set PW_EXECUTABLE if Chromium is elsewhere.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS_DIR ?? "test-results/screens";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`ok   - ${name}`);
  } catch (e) {
    failures++;
    results.push(`FAIL - ${name}\n       ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
/** Phone layouts must never scroll sideways. */
async function noHorizontalScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw <= iw + 1, `${label}: page is ${sw}px wide on a ${iw}px screen (horizontal scroll)`);
}

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

async function asPersona(name, opts = mobile) {
  const ctx = await browser.newContext({ ...opts, baseURL: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.push(`warn - page error (${name}): ${e.message}`));
  await page.goto("/");
  await page.getByRole("button", { name: `Enter as ${name}` }).click();
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

// ---------------------------------------------------------------- staff --
let newOrderCode = "";
await step("staff: Today's Work lists task queues", async () => {
  const { page, ctx } = await asPersona("Gilbert Decena", desktop);
  expect(page.url().endsWith("/staff"), `expected /staff, got ${page.url()}`);
  for (const h of ["Record customer spec confirmation", "Log 30% down payment", "Verify driver cash handover", "Failed SMS updates"])
    expect(await page.getByRole("heading", { name: h }).isVisible(), `missing section ${h}`);
  await page.screenshot({ path: `${SHOTS}/staff-desktop.png`, fullPage: true });
  await ctx.close();
});

await step("staff: new order form validates then saves a DR draft with PIN slip", async () => {
  const { page, ctx } = await asPersona("Gilbert Decena");
  await page.goto("/staff/new");
  await page.getByRole("button", { name: "Save order" }).click();
  await page.getByText("Paper Slip # is required.").waitFor();
  await page.fill("#paper_slip_number", "0145"); // duplicate of a seeded slip
  await page.fill("#customer_name", "Rosalie Ompad");
  await page.fill("#customer_phone", "0900 000 0202");
  await page.selectOption("#municipality", "Lantapan");
  await page.fill("#delivery_fee", "800");
  await page.fill("#delivery_address", "Purok 2, Brgy. Alanib, near the school");
  await page.fill("#item_name", "Narra-look Bench");
  await page.fill("#dimensions", "150cm x 40cm x 45cm");
  await page.fill("#color_finish", "Honey Oak");
  await page.fill("#furniture_price", "6000");
  expect((await page.locator("dl[aria-live]").innerText()).includes("₱1,800"), "30% preview should be ₱1,800");
  await noHorizontalScroll(page, "staff-new-order-mobile");
  await page.screenshot({ path: `${SHOTS}/staff-new-order-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Save order" }).click();
  await page.getByText("Paper slip #0145 is already encoded.").first().waitFor();
  await page.fill("#paper_slip_number", "0149");
  await page.getByRole("button", { name: "Save order" }).click();
  await page.waitForURL(/\/slip\?new=1/);
  newOrderCode = (await page.locator("article .font-mono").first().innerText()).trim();
  expect(/^DR-\d{4}$/.test(newOrderCode), `draft code expected, got ${newOrderCode}`);
  expect(/^\d{4}$/.test((await page.locator("article .font-mono").nth(2).innerText()).trim()), "PIN on slip");
  expect(await page.locator("article svg").first().isVisible(), "QR code on slip");
  await noHorizontalScroll(page, "staff-slip-mobile");
  await page.screenshot({ path: `${SHOTS}/staff-slip-mobile.png`, fullPage: true });

  // record confirmation from the order page → JJ code + Confirmed
  await page.getByRole("link", { name: "Back to order" }).click();
  await page.getByRole("button", { name: "Record confirmation" }).click();
  await page.getByRole("button", { name: "Confirm specifications" }).click();
  await page.getByText("Specifications confirmed").waitFor();
  await page.waitForLoadState("networkidle");
  const title = await page.locator("h1").innerText();
  expect(/^JJ-\d{4}-0149$/.test(title.trim()), `promoted code expected, got ${title}`);
  newOrderCode = title.trim();
  await ctx.close();
});

// ---------------------------------------------------------------- owner --
await step("owner: KPIs, approve installment, pass inspection, reprioritise", async () => {
  const { page, ctx } = await asPersona("Mr. Vincris Lelis", desktop);
  expect(page.url().endsWith("/owner"), "owner portal");
  for (const k of ["Active Orders", "Delayed / At Risk", "In Production", "Waiting Inspection", "Deliveries to Watch", "Balances Still to Collect", "Unpaid After Delivery", "Approvals Waiting"])
    expect(await page.getByText(k, { exact: true }).first().isVisible(), `KPI ${k}`);
  await page.screenshot({ path: `${SHOTS}/owner-desktop.png`, fullPage: true });
  const installment = page.locator("li", { hasText: "Installment Approval" }).first();
  await installment.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await page.getByText("Marked approved").waitFor();
  const insp = page.locator("li", { hasText: "Quality inspection" }).first();
  await insp.getByRole("button", { name: "Pass" }).click();
  await page.getByRole("button", { name: "Passed — ready for delivery" }).click();
  await page.getByText("Inspection passed").waitFor();
  const queueItems = page.locator("section", { hasText: "Planning Board · production priority" }).locator("ol > li");
  const second = (await queueItems.nth(1).locator("a").first().innerText()).trim();
  await queueItems.nth(1).getByRole("button", { name: "Move up" }).click();
  await page.waitForTimeout(800);
  await page.waitForLoadState("networkidle");
  const nowFirst = (await queueItems.nth(0).locator("a").first().innerText()).trim();
  expect(nowFirst === second, `move up: expected ${second} first, got ${nowFirst}`);
  await ctx.close();
});

// ------------------------------------------------------------ craftsman --
await step("craftsman: no money on screen; start work moves job to In Progress", async () => {
  const { page, ctx } = await asPersona("Nolito Remulta");
  expect(page.url().endsWith("/craftsman"), "craftsman portal");
  const html = await page.content();
  expect(!html.includes("₱") && !/furniture_price|collectible|remaining_furniture_balance|customer_phone/.test(html), "financial data leaked to craftsman page");
  await noHorizontalScroll(page, "craftsman-mobile");
  await page.screenshot({ path: `${SHOTS}/craftsman-mobile.png`, fullPage: true });
  expect(newOrderCode, "depends on the new-order step");
  const card = page.locator("li", { hasText: newOrderCode }).first();
  await card.getByRole("button", { name: "Start Work" }).click();
  await page.getByRole("button", { name: "Yes, start now" }).click();
  await page.getByText("Moved to “In Production”").waitFor();
  await page.getByRole("tab", { name: /In Progress/ }).click();
  expect(await page.locator("li", { hasText: newOrderCode }).isVisible(), "job should appear in In Progress");
  await ctx.close();
});

// --------------------------------------------------------------- driver --
await step("driver: offline action is queued locally, then syncs when online", async () => {
  const { page, ctx } = await asPersona("Jesse Decena");
  expect(page.url().endsWith("/driver"), "driver portal");
  await page.getByText("Online • Synced").waitFor();
  expect((await page.content()).includes("COLLECT ON DELIVERY") || (await page.getByText("Collect on delivery").first().isVisible()), "collectible shown");
  await page.getByRole("switch", { name: "Simulate Offline / Weak Signal" }).click();
  const card = page.locator("li", { hasText: "JJ-2026-0138" });
  await card.getByRole("button", { name: "Start Trip" }).click();
  await page.getByText("Offline • Saved Locally (1 pending)").waitFor();
  expect(await page.getByText("Saved Locally — Pending Sync").first().isVisible(), "honest local label");
  await noHorizontalScroll(page, "driver-offline-mobile");
  await page.screenshot({ path: `${SHOTS}/driver-offline-mobile.png`, fullPage: true });
  // still works after a reload while "offline" (IndexedDB)
  await page.getByRole("switch", { name: "Simulate Offline / Weak Signal" }).click();
  await page.getByText("Online • Synced").waitFor({ timeout: 10000 });
  await page.locator("li", { hasText: "JJ-2026-0138" }).getByRole("button", { name: "Mark Delivered & Log Cash Collected" }).click();
  await page.getByRole("button", { name: "Save delivery" }).click();
  await page.getByText(/Synced 1 action/).first().waitFor({ timeout: 10000 });
  await page.getByRole("tab", { name: /Done/ }).click();
  expect(await page.locator("li", { hasText: "JJ-2026-0138" }).isVisible(), "delivered trip in Done tab");
  await noHorizontalScroll(page, "driver-synced-mobile");
  await page.screenshot({ path: `${SHOTS}/driver-synced-mobile.png`, fullPage: true });
  await ctx.close();
});

await step("staff: driver cash appears as a handover to verify", async () => {
  const { page, ctx } = await asPersona("Gilbert Decena");
  const row = page.locator("li", { hasText: "JJ-2026-0138" }).filter({ hasText: "Delivery Balance Collection" });
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: /Verify ₱5,600/ }).click();
  await page.getByText("Cash handover verified").waitFor();
  await ctx.close();
});

// ------------------------------------------------------------- customer --
await step("customer: Order ID only hides money; PIN unlocks full view and confirm", async () => {
  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto("/track");
  await page.fill("#order_code", "JJ-2026-0145");
  await page.getByRole("button", { name: "Check status only" }).click();
  await page.getByText("Estimated completion").first().waitFor();
  const card = await page.getByTestId("track-result").innerText();
  expect(!card.includes("₱") && !card.includes("0900"), "Order-ID-only view must not show money or phone");
  await noHorizontalScroll(page, "customer-track-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-track-mobile.png`, fullPage: true });
  await page.fill("#pin", "0000");
  await page.getByRole("button", { name: "Open with PIN" }).click();
  await page.getByText(/do not match/).waitFor();
  await page.fill("#pin", "4821");
  await page.getByRole("button", { name: "Open with PIN" }).click();
  await page.waitForURL(/\/track\/order/);
  expect((await page.content()).includes("₱"), "full view shows payment summary");
  await noHorizontalScroll(page, "customer-order-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-order-mobile.png`, fullPage: true });

  await page.goto("/track");
  await page.getByRole("button", { name: /DR-0148/ }).click();
  await page.waitForURL(/\/track\/order/);
  await page.getByRole("button", { name: "Confirm Specifications" }).click();
  await page.getByRole("button", { name: "Yes, these are correct" }).click();
  await page.getByText("Thank you! Your specifications are confirmed.").waitFor();
  await ctx.close();
});

await step("security: craftsman cannot open office or driver pages", async () => {
  const { page, ctx } = await asPersona("Carlo");
  for (const path of ["/owner", "/staff", "/driver"]) {
    await page.goto(path);
    expect(page.url().endsWith("/craftsman"), `${path} should bounce to /craftsman, got ${page.url()}`);
  }
  const r = await page.request.get("/api/driver/manifest");
  expect(r.status() === 403, `manifest API should be 403 for craftsman, got ${r.status()}`);
  await ctx.close();
});

await step("theme: dark mode renders with prototype palette", async () => {
  const { page, ctx } = await asPersona("Mr. Vincris Lelis");
  await page.getByRole("button", { name: "Switch to Dark mode" }).click();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg === "rgb(11, 11, 12)", `dark background expected #0B0B0C, got ${bg}`);
  await page.screenshot({ path: `${SHOTS}/owner-dark-mobile.png`, fullPage: false });
  await ctx.close();
});

await browser.close();
console.log(results.join("\n"));
console.log(failures ? `\n${failures} E2E step(s) FAILED` : "\nALL E2E STEPS PASSED");
process.exit(failures ? 1 : 0);
