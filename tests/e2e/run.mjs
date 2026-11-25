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
    const at = String(e?.stack ?? "").split("\n").find((l) => l.includes("run.mjs:"))?.trim() ?? "";
    results.push(`FAIL - ${name}\n       ${String(e?.message ?? e).split("\n")[0]} ${at}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
/** Phone layouts must never scroll sideways. */
async function noHorizontalScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw <= iw + 1, `${label}: page is ${sw}px wide on a ${iw}px screen (horizontal scroll)`);
  // also catch content that is clipped by an overflow-hidden card instead of scrolling the page
  const clipped = await page.evaluate(() => {
    const iw = window.innerWidth;
    const scrolls = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
    return [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > iw + 1 && getComputedStyle(el).visibility !== "hidden" && !el.closest(".sr-only") && !scrolls(el);
    }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
  });
  expect(clipped.length === 0, `${label}: content wider than the ${iw}px screen: ${clipped.join(" | ")}`);
}

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

const ACCOUNT = { "Gilbert Decena": "Staff", "Mr. Vincris Lelis": "Owner", "Nolito Remulta": "Craftsman", "Jesse Decena": "Delivery Rider" };
/** Sign in with the fixed demo account of that persona (Demo Mode login page). */
async function asPersona(name, opts = mobile) {
  const ctx = await browser.newContext({ ...opts, baseURL: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.push(`warn - page error (${name}): ${e.message}`));
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${ACCOUNT[name]}` }).click();
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

/** Demo inbox: the newest link of a given kind sent to an address (path only). */
async function inboxLink(page, to, kind = "/customer/review") {
  await page.goto("/demo/inbox");
  const item = page.getByTestId("inbox-item").filter({ hasText: to }).filter({ has: page.locator(`a[href^="${kind}"]`) }).first();
  await item.waitFor();
  return item.locator(`a[href^="${kind}"]`).first().getAttribute("href");
}
/** Office workspace: open an order's slide-over drawer from the queue. */
async function openOrder(page, code, base = "/staff") {
  if (!new URL(page.url()).pathname.startsWith(base)) await page.goto(base);
  await page.getByTestId("queue-search").fill(code); // search spans every stage
  await page.locator(`[data-testid="queue-row"][data-code="${code}"], [data-testid="queue-card"][data-code="${code}"]`).filter({ visible: true }).first().click();
  const drawer = page.getByTestId("order-drawer");
  await drawer.waitFor();
  await drawer.getByRole("heading", { name: code }).waitFor();
  return drawer;
}
async function openReview(page, href) {
  await page.goto(href);
  await page.getByRole("button", { name: "Open my quotation" }).click();
  await page.waitForURL(/\/customer\/review\/quote/);
}
// ---------------------------------------------------------------- staff --
let newOrderCode = "";
await step("staff: Today's Work lists task queues", async () => {
  const { page, ctx } = await asPersona("Gilbert Decena", desktop);
  const cron = await page.request.post("/api/notifications/process");
  expect([401, 503].includes(cron.status()), `a staff session must not run the queue worker, got ${cron.status()}`);
  const cronBad = await page.request.post("/api/notifications/process", { headers: { authorization: "Bearer not-the-secret" } });
  expect([401, 503].includes(cronBad.status()), `a wrong bearer must be refused, got ${cronBad.status()}`);
  if (process.env.CRON_SECRET) {
    const ok = await page.request.post("/api/notifications/process", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status() === 200 && (await ok.json()).provider === "demo", `the scheduler's bearer secret runs the worker, got ${ok.status()}`);
  }
  expect(page.url().endsWith("/staff"), `expected /staff, got ${page.url()}`);
  await page.getByRole("heading", { name: "Operations & Order Queue" }).waitFor();
  for (const id of ["kpi-to-confirm", "kpi-quote-payment", "kpi-workshop", "kpi-delivery", "kpi-deposits"]) expect(await page.getByTestId(id).isVisible(), `metric ${id}`);
  for (const f of ["active", "to_confirm", "quote_payment", "production", "delivery"]) expect(await page.getByTestId(`filter-${f}`).isVisible(), `filter ${f}`);
  expect((await page.getByTestId("queue-row").count()) > 0, "queue rows");
  // the table shows no raw emails or street addresses (they appear in the drawer only)
  expect(!/@example\.com|Purok/.test(await page.getByTestId("order-queue").innerText()), "no emails / addresses in the queue");
  // filters + search
  await page.getByTestId("filter-to_confirm").click();
  expect((await page.getByTestId("queue-row").evaluateAll((rows) => rows.length > 0 && rows.every((r) => /Quote Requested|Waiting/.test(r.textContent)))), "To confirm shows only orders waiting for the shop");
  await page.getByTestId("filter-active").click();
  await page.getByTestId("queue-search").fill("0145");
  expect((await page.getByTestId("queue-row").count()) === 1, "search by order ID");
  await page.getByTestId("queue-search").fill("");
  // the drawer: 3 tabs, the existing 3D/2D preview, closes back to the queue
  const drawer = await openOrder(page, "JJ-2026-0145");
  for (const t of ["Overview & 3D Spec", "Quotation & Revisions", "Payments & Gate"]) expect(await drawer.getByRole("tab", { name: t }).isVisible(), `tab ${t}`);
  await drawer.getByRole("tab", { name: "Payments & Gate" }).click();
  expect((await drawer.getByTestId("gate-status").innerText()).includes("gate is met"), "0145: 30% verified gate");
  await page.screenshot({ path: `${SHOTS}/staff-drawer-desktop.png` });
  await page.getByTestId("drawer-close").click();
  await page.getByTestId("order-drawer").waitFor({ state: "detached" });
  await page.screenshot({ path: `${SHOTS}/staff-desktop.png`, fullPage: true });
  await ctx.close();
});

await step("staff: new order form validates (email or walk-in) then saves with its permanent JJ code; slip shows the email, no PIN; confirm + quotation in one step → acceptance → 30% gate", async () => {
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
  await page.fill("#customer_email", " Rosalie.Ompad@Example.com ");
  // configurator: Custom Piece → Bookshelf / Divider, custom W×H×D, Other wood needs a note
  await page.getByTestId("cat-Custom Piece").click();
  // click the visible chip (not a forced click on the hidden radio): Playwright then checks nothing (e.g. the pinned 3D view) covers it
  await page.locator("label", { hasText: "Bookshelf / Divider" }).click();
  await page.fill('input[name="width_cm"]', "150");
  await page.fill('input[name="height_cm"]', "40");
  await page.fill('input[name="depth_cm"]', "45");
  await page.getByTestId("wood-Other").click();
  await page.getByTestId("finish-Walnut Stain").click();
  await page.fill("#furniture_price", "6000");
  expect((await page.locator("dl[aria-live]").innerText()).includes("₱1,800"), "30% preview should be ₱1,800");
  await noHorizontalScroll(page, "staff-new-order-mobile");
  await page.screenshot({ path: `${SHOTS}/staff-new-order-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Save order" }).click();
  await page.getByText('Describe the wood when "Other" is selected.').first().waitFor();
  await page.fill('input[name="custom_wood_note"]', "Narra offcuts supplied by the customer");
  await page.getByRole("button", { name: "Save order" }).click();
  await page.getByText("Paper slip #0145 is already encoded.").first().waitFor();
  await page.fill("#paper_slip_number", "0149");
  await page.getByRole("button", { name: "Save order" }).click();
  await page.waitForURL(/\/slip\?new=1/);
  newOrderCode = (await page.locator("article .font-mono").first().innerText()).trim();
  expect(/^JJ-\d{4}-0149$/.test(newOrderCode), `permanent JJ code expected at once, got ${newOrderCode}`);
  expect((await page.getByTestId("slip-contact").innerText()).trim() === "rosalie.ompad@example.com", "slip shows the normalized email (no PIN)");
  expect(await page.locator("article svg").first().isVisible(), "QR code on slip");
  await noHorizontalScroll(page, "staff-slip-mobile");
  await page.screenshot({ path: `${SHOTS}/staff-slip-mobile.png`, fullPage: true });

  // confirming the order issues the quotation in the same step (the customer is emailed to create a password)
  await page.getByRole("link", { name: "Back to order" }).click();
  await page.getByTestId("next-step").getByRole("button", { name: "Confirm order" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm & issue quotation" }).click();
  await page.getByText("Order confirmed and quotation issued. The customer was emailed a link to create their password and accept the quotation.").first().waitFor();
  // the customer accepts at the counter: staff record it with the chosen payment terms
  await page.getByTestId("next-step").getByRole("button", { name: "Record acceptance" }).click();
  await page.getByRole("dialog").locator("#payment_plan").selectOption("down_30");
  await page.getByRole("dialog").getByRole("button", { name: "Record acceptance" }).click();
  await page.getByText(/Quotation \(revision \d+\) accepted/).first().waitFor();
  await page.waitForLoadState("networkidle");
  const title = await page.locator("h1").innerText();
  expect(title.trim() === newOrderCode, `the Order ID never changes, got ${title}`);

  // Confirmed is not authorization to cut wood: the release is refused until 30% is verified
  await page.getByRole("button", { name: "Release to workshop" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Start production" }).click();
  await page.getByText(/verified 30% down payment .* is required before production/).first().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Log payment" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Save payment" }).click();
  await page.getByText("Payment recorded.").first().waitFor();
  await page.getByRole("button", { name: "Release to workshop" }).first().click();
  expect((await page.getByRole("dialog").innerText()).includes("30% verified ✓"), "release dialog shows the verified gate");
  await page.getByRole("dialog").getByRole("button", { name: "Start production" }).click();
  await page.getByText("Released to the workshop.").first().waitFor();
  await page.getByTestId("spec-locked").first().waitFor(); // the production lock is visible on the order
  await ctx.close();
});

// ---------------------------------------------------------------- owner --
await step("owner: sidebar dashboard KPIs, approve installment, pass inspection, sections, assign + reprioritise, lumber", async () => {
  const { page, ctx } = await asPersona("Mr. Vincris Lelis", desktop);
  expect(page.url().endsWith("/owner"), "owner portal");
  await page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Vincris$/ }).waitFor();
  for (const label of ["Dashboard", "Orders & Quotations", "Payments to verify", "Staff", "Craftsmen", "Deliveries", "Lumber & Inventory", "Reports", "Roles & Access"])
    expect(await page.getByTestId("owner-nav").getByRole("link", { name: new RegExp(`^${label.replace("&", "&")}`) }).isVisible(), `sidebar ${label}`);
  for (const id of ["kpi-to-confirm", "kpi-quote-payment", "kpi-workshop", "kpi-delivery", "kpi-deposits", "kpi-balances", "kpi-late", "kpi-low-stock"]) expect(await page.getByTestId(id).isVisible(), `metric ${id}`);
  expect((await page.getByTestId("low-stock").locator("li").count()) >= 1, "low lumber stock is flagged on the dashboard");
  await page.getByRole("heading", { name: "Awaiting your decision" }).waitFor();
  await page.screenshot({ path: `${SHOTS}/owner-desktop.png`, fullPage: true });
  const installment = page.locator("li", { hasText: "Installment Approval" }).first();
  await installment.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await page.getByText("Marked approved").waitFor();
  const insp = page.locator("li", { hasText: "Quality inspection" }).first();
  await insp.getByRole("button", { name: "Pass" }).click();
  await page.getByRole("button", { name: "Passed — ready for delivery" }).click();
  await page.getByText("Inspection passed").waitFor();
  // every section opens from the sidebar
  for (const [label, heading] of [["Orders & Quotations", "Orders & Quotations"], ["Payments to verify", "Payments to verify"], ["Staff", "Staff"], ["Deliveries", "Deliveries"], ["Reports", "Reports"], ["Roles & Access", "Roles & Access"]]) {
    await page.getByTestId("owner-nav").getByRole("link", { name: new RegExp(`^${label}`) }).click();
    await page.getByRole("heading", { level: 1, name: heading, exact: true }).waitFor();
  }
  expect((await page.getByTestId("access-matrix").locator("tbody tr").count()) > 5, "permission matrix");
  // lumber: receive 10 pieces of 2" x 4" x 10 ft = 66.67 bf; using more than on hand is refused
  await page.getByTestId("owner-nav").getByRole("link", { name: /^Lumber & Inventory/ }).click();
  await page.getByRole("heading", { level: 1, name: "Lumber & Inventory" }).waitFor();
  const row = page.getByTestId("stock-row").filter({ hasText: "Acacia" }).first();
  const before = Number((await row.locator("b.text-xl").innerText()).replace(/[^0-9.]/g, ""));
  await row.getByRole("button", { name: "Receive" }).click();
  const dlg = page.getByRole("dialog");
  for (const [id, v] of [["#lm-pieces", "10"], ["#lm-thickness_in", "2"], ["#lm-width_in", "4"], ["#lm-length_ft", "10"]]) await dlg.locator(id).fill(v);
  expect((await dlg.innerText()).includes("66.67"), "live board-feet calculation");
  await dlg.getByRole("button", { name: "Add to stock" }).click();
  await page.getByText("Received 66.67 board feet.").first().waitFor();
  await page.waitForLoadState("networkidle");
  const after = Number((await row.locator("b.text-xl").innerText()).replace(/[^0-9.]/g, ""));
  expect(Math.abs(after - before - 66.67) < 0.01, `on hand ${before} → ${after}`);
  await row.getByRole("button", { name: "Use" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Board feet" }).click();
  await page.getByRole("dialog").locator("#lm-bf").fill("99999");
  await page.getByRole("dialog").getByRole("button", { name: "Take from stock" }).click();
  await page.getByText(/Only .* board feet of Acacia on hand/).first().waitFor();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SHOTS}/owner-inventory-desktop.png`, fullPage: true });
  // craftsmen: assign a job, then reprioritise the production queue
  await page.getByTestId("owner-nav").getByRole("link", { name: /^Craftsmen/ }).click();
  await page.getByRole("heading", { level: 1, name: "Craftsmen" }).waitFor();
  const queueItems = page.getByTestId("planning-board").locator("ol > li");
  const second = (await queueItems.nth(1).locator("a").first().innerText()).trim();
  await queueItems.nth(1).getByRole("button", { name: "Move up" }).click();
  await page.waitForTimeout(800);
  await page.waitForLoadState("networkidle");
  const nowFirst = (await queueItems.nth(0).locator("a").first().innerText()).trim();
  expect(nowFirst === second, `move up: expected ${second} first, got ${nowFirst}`);
  await ctx.close();
});

// ------------------------------------------------------------ craftsman --
await step("craftsman: no money on screen; cannot start production; finishes a released job", async () => {
  const { page, ctx } = await asPersona("Nolito Remulta");
  expect(page.url().endsWith("/craftsman"), "craftsman portal");
  const html = await page.content();
  expect(!html.includes("₱") && !/furniture_price|collectible|remaining_furniture_balance|customer_phone/.test(html), "financial data leaked to craftsman page");
  await noHorizontalScroll(page, "craftsman-mobile");
  await page.screenshot({ path: `${SHOTS}/craftsman-mobile.png`, fullPage: true });
  expect(newOrderCode, "depends on the new-order step");
  // craftsmen cannot start production: Confirmed jobs are "Up next" with no start button
  expect((await page.getByTestId("awaiting-release").count()) > 0, "Up next jobs show the awaiting-release note");
  expect((await page.getByRole("button", { name: "Start Work" }).count()) === 0, "no Start Work button for craftsmen");
  // the job released by the office is in progress; the craftsman finishes the build
  await page.getByRole("tab", { name: /In Progress/ }).click();
  const card = page.locator("li", { hasText: newOrderCode }).first();
  await card.getByRole("button", { name: "Mark Ready for Owner Inspection" }).click();
  for (const box of await page.getByRole("dialog").getByRole("checkbox").all()) await box.check();
  await page.getByRole("dialog").getByRole("button", { name: "Send to owner" }).click();
  await page.getByText("Moved to “Completed / For Inspection”").waitFor();
  await ctx.close();
});

// --------------------------------------------------------------- driver --
await step("driver: flat rows with status pills → detail; offline action is queued locally, then syncs when online", async () => {
  const { page, ctx } = await asPersona("Jesse Decena");
  expect(page.url().endsWith("/driver"), "driver portal");
  await page.getByText("Online • Synced").waitFor();
  // rows: order, customer, municipality, cash to collect and a status pill (no boxed cards)
  const rows = page.getByTestId("delivery-rows");
  expect((await rows.getByTestId("delivery-pill").count()) === (await rows.getByTestId("delivery-row").count()), "every row has a status pill");
  expect((await rows.innerText()).includes("In transit") && (await rows.innerText()).includes("On process"), "rider words: On process / In transit");
  const open = async (code) => {
    if (await page.getByTestId("delivery-back").count()) await page.getByTestId("delivery-back").click();
    await page.locator(`[data-testid="delivery-rows"] li[data-code="${code}"]`).getByTestId("delivery-row").click();
    return page.getByTestId("delivery-detail");
  };
  let detail = await open("JJ-2026-0138");
  expect(await detail.getByText("Collect on delivery").isVisible(), "collectible shown in the detail");
  await page.getByRole("switch", { name: "Simulate Offline / Weak Signal" }).click();
  await detail.getByRole("button", { name: "Start Trip" }).click();
  await page.getByText("Offline • Saved Locally (1 pending)").waitFor();
  expect(await page.getByText("Saved Locally — Pending Sync").first().isVisible(), "honest local label");
  await noHorizontalScroll(page, "driver-offline-mobile");
  await page.screenshot({ path: `${SHOTS}/driver-offline-mobile.png`, fullPage: true });
  await page.getByRole("switch", { name: "Simulate Offline / Weak Signal" }).click();
  await page.getByText("Online • Synced").waitFor({ timeout: 10000 });
  detail = page.getByTestId("delivery-detail");
  await detail.getByRole("button", { name: "Mark Delivered & Log Cash Collected" }).click();
  await page.getByRole("button", { name: "Save delivery" }).click();
  await page.getByText(/Synced 1 action/).first().waitFor({ timeout: 10000 });
  await page.getByTestId("delivery-back").click();
  await page.getByRole("tab", { name: /Done/ }).click();
  const done = page.locator('[data-testid="delivery-rows"] li[data-code="JJ-2026-0138"]');
  expect(await done.isVisible(), "delivered trip in Done tab");
  expect((await done.innerText()).includes("Delivered"), "Delivered pill");
  await noHorizontalScroll(page, "driver-synced-mobile");
  await page.screenshot({ path: `${SHOTS}/driver-synced-mobile.png`, fullPage: true });
  await ctx.close();
});

await step("staff: driver cash appears as a handover to verify", async () => {
  const { page, ctx } = await asPersona("Gilbert Decena");
  // phone: the queue is a stacked list and the drawer a full-screen sheet
  const drawer = await openOrder(page, "JJ-2026-0138");
  await noHorizontalScroll(page, "staff-drawer-mobile");
  await drawer.getByRole("tab", { name: "Payments & Gate" }).click();
  expect((await drawer.getByText("Unverified submissions (not counted)").count()) > 0, "unverified submissions shown separately");
  page.once("dialog", (d) => d.accept());
  await drawer.getByRole("button", { name: /Verify ₱5,600/ }).click();
  await page.getByText("Cash handover verified").waitFor();
  await ctx.close();
});

// ------------------------------------------------------------- customer --
await step("customer: no Order ID + PIN lookup; Option 1 email login (demo button) → own orders + change request; review link → accept → set password; forgot password", async () => {
  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  const page = await ctx.newPage();
  // the retired lookup URL (old slips / QR codes) lands on the email login; no Order ID or PIN fields anywhere
  await page.goto("/track?code=JJ-2026-0145");
  await page.waitForURL(/\/customer\/login/);
  await page.goto("/customer");
  await page.waitForURL(/\/customer\/login/);
  expect((await page.locator("#order_code, #pin").count()) === 0, "no Order ID / PIN inputs");
  for (const label of ["Check status only", "Open with PIN"])
    expect((await page.getByRole("button", { name: label }).count()) === 0, `no [${label}] button`);
  await page.getByRole("heading", { name: "Log In to Track My Orders" }).waitFor();
  await page.getByRole("heading", { name: "Customize & Request a Quote" }).waitFor();
  await noHorizontalScroll(page, "customer-portal-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-portal-mobile.png`, fullPage: true });
  // the dashboard needs a customer session
  await page.goto("/customer/orders");
  await page.waitForURL(/\/customer\/login/);

  // wrong password: generic error (no account enumeration)
  await page.fill("#email", "maria.santos@example.com");
  await page.fill("#password", "wrong-password-123");
  await page.getByRole("button", { name: "Log In to Track My Orders" }).click();
  await page.getByTestId("login-error").waitFor();
  expect((await page.getByTestId("login-error").innerText()).includes("Email or password is incorrect"), "generic login error");
  // [Demo Customer Login (Maria Santos)] (demo mode only) → dashboard of her linked orders only
  await page.getByTestId("demo-customer-login").click();
  await page.waitForURL(/\/customer\/orders/);
  const list = await page.getByTestId("customer-orders").innerText();
  expect(list.includes("JJ-2026-0145") && !list.includes("JJ-2026-0136") && !list.includes("JJ-2026-0133"), "dashboard lists only this account's orders (legacy orders are not auto-linked)");
  await noHorizontalScroll(page, "customer-dashboard-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-dashboard-mobile.png`, fullPage: true });
  await page.getByText("JJ-2026-0145").first().click();
  await page.getByTestId("approved-spec").waitFor();
  expect((await page.getByTestId("payment-summary").innerText()).includes("₱"), "payment summary on the order page");
  // post-confirmation change / repair request (own order only)
  await page.getByRole("button", { name: "Request Post-Confirmation Change / Repair" }).click();
  await page.selectOption("#kind", "repair");
  await page.fill("#description", "Small scratch on the left leg, about 3 cm.");
  await page.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
  await page.getByText("Request sent. The shop will contact you").first().waitFor();
  await page.goto("/customer/orders/JJ-2026-0136");
  expect((await page.getByText(/could not be found|not found|404/i).count()) > 0, "another customer's order is not reachable");
  await page.goto("/customer/orders");
  await page.getByTestId("customer-logout").first().click();
  await page.waitForURL(/\/customer\/login/);

  // review links still work WITHOUT a login: Ramon accepts from his (simulated) inbox, then sets a password
  const href = await inboxLink(page, "ramon.delacruz@example.com");
  await openReview(page, href);
  await noHorizontalScroll(page, "customer-review-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-review-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Accept Quote & Confirm Specifications" }).click();
  await page.getByTestId("accept-specification").check();
  await page.getByRole("dialog").getByRole("button", { name: "Accept quote & confirm" }).click();
  expect(await page.getByRole("dialog").isVisible(), "dialog stays open until the quotation box is ticked");
  await page.getByTestId("accept-quotation").check();
  await page.getByRole("dialog").getByRole("button", { name: "Accept quote & confirm" }).click();
  await page.getByTestId("setup-email-sent").waitFor();
  // the same link cannot be used twice; a made-up token is refused
  await page.goto(href);
  await page.getByRole("button", { name: "Open my quotation" }).click();
  expect((await page.getByTestId("review-error").innerText()).includes("already used"), "review link is single-use");
  await page.goto("/customer/review?token=not-a-real-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await page.getByRole("button", { name: "Open my quotation" }).click();
  await page.getByTestId("review-error").waitFor();
  const setup = await inboxLink(page, "ramon.delacruz@example.com", "/customer/set-password");
  await page.goto(setup);
  const save = page.getByRole("button", { name: "Save password" });
  await page.fill("#password", "short");
  await page.fill("#confirm", "short");
  expect(await save.isDisabled(), "Save stays disabled under 8 characters");
  expect((await page.getByTestId("password-strength").innerText()).includes("more characters needed"), "strength feedback explains the minimum");
  await page.fill("#password", "Kamagong-Bed-2026");
  await page.fill("#confirm", "Kamagong-Bed-2025");
  expect(await save.isDisabled(), "Save stays disabled until both passwords match");
  await page.getByTestId("toggle-password").click();
  expect((await page.getAttribute("#password", "type")) === "text", "show / hide password");
  // the server still validates (here: the email name inside the password)
  await page.fill("#password", "ramon.delacruz-2026");
  await page.fill("#confirm", "ramon.delacruz-2026");
  await save.click();
  await page.getByTestId("setup-error").waitFor();
  await page.fill("#password", "Kamagong-Bed-2026");
  await page.fill("#confirm", "Kamagong-Bed-2026");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL(/\/customer\/orders/);
  await page.getByTestId("welcome").waitFor();
  expect((await page.getByTestId("customer-orders").innerText()).includes("0148"), "accepted order appears in the new account");
  await page.getByTestId("customer-logout").first().click();
  await page.waitForURL(/\/customer\/login/);

  // [Forgot Password?] → one-time reset link → new password → typed email + password login → /customer/orders
  await page.getByRole("link", { name: "Forgot Password?" }).click();
  await page.waitForURL(/\/customer\/forgot-password/);
  await page.fill("#email", "ramon.delacruz@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByTestId("forgot-result").waitFor();
  const reset = await inboxLink(page, "ramon.delacruz@example.com", "/customer/set-password");
  expect(reset !== setup, "a fresh reset link was emailed");
  await page.goto(reset);
  await page.fill("#password", "Yakal-Chair-2027");
  await page.fill("#confirm", "Yakal-Chair-2027");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL(/\/customer\/orders/);
  await page.getByTestId("customer-logout").first().click();
  await page.waitForURL(/\/customer\/login/);
  await page.fill("#email", "ramon.delacruz@example.com");
  await page.fill("#password", "Yakal-Chair-2027");
  await page.getByRole("button", { name: "Log In to Track My Orders" }).click();
  await page.waitForURL(/\/customer\/orders/);
  // a signed-in CUSTOMER cannot use the staff resend endpoint or the cron worker
  const asCustomer = await page.request.post("/api/notifications/resend", { data: { order_id: "00000000-0000-4000-8000-000000000000", kind: "quote_review" } });
  expect(asCustomer.status() === 401, `customer → resend must be 401, got ${asCustomer.status()}`);
  const cronAsCustomer = await page.request.post("/api/notifications/process");
  expect([401, 503].includes(cronAsCustomer.status()), `customer → process must be refused, got ${cronAsCustomer.status()}`);
  // public set-up link endpoint: identical generic answer for a registered and an unknown address
  const known = await page.request.post("/api/auth/request-setup-link", { data: { email: "maria.santos@example.com" } });
  const unknown = await page.request.post("/api/auth/request-setup-link", { data: { email: "no.such.person@example.com" } });
  expect(known.status() === 200 && unknown.status() === 200, "both 200");
  expect(JSON.stringify(await known.json()) === JSON.stringify(await unknown.json()), "identical response bodies (no enumeration)");
  await page.getByTestId("customer-orders").waitFor();
  await ctx.close();
});

await step("customer: staff resend link → propose changes in the review session → staff re-quote → new link → accept", async () => {
  const staff = await asPersona("Gilbert Decena", desktop);
  const drawer = await openOrder(staff.page, "JJ-2026-0144");
  expect((await drawer.getByTestId("customer-email-status").innerText()).includes("unverified"), "email shown as unverified");
  await drawer.getByRole("tab", { name: "Quotation & Revisions" }).click();
  staff.page.once("dialog", (d) => d.accept());
  await drawer.getByRole("button", { name: "Resend review link" }).click();
  await staff.page.getByText("A new single-use review link was emailed to the customer.").first().waitFor();

  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  const page = await ctx.newPage();
  await openReview(page, await inboxLink(page, "jocelyn.tan@example.com"));
  // mobile preview bar must not cover the inputs it describes
  await page.getByTestId("wood-Mahogany").scrollIntoViewIfNeeded();
  const bar = await page.getByTestId("configurator-pin").boundingBox();
  const chip = await page.getByTestId("wood-Mahogany").boundingBox();
  expect(bar && chip && chip.y >= bar.y + bar.height - 1, "mobile preview bar covers the wood chips");
  await page.getByTestId("wood-Mahogany").click();
  await page.fill('input[name="width_cm"]', "180");
  const diff = await page.getByText("Your changes:").locator("..").innerText();
  expect(diff.includes("Wood: Gmelina -> Mahogany") && diff.includes("Width: 150cm -> 180cm"), `diff text: ${diff}`);
  await noHorizontalScroll(page, "customer-proposal-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-proposal-mobile.png`, fullPage: false });
  await page.getByRole("button", { name: "Submit Specification Changes for Review" }).click();
  await page.getByTestId("review-proposal-sent").waitFor();

  // staff see the proposal with the exact diff and send a revised quote (emails a fresh link)
  await staff.page.goto("/staff");
  // the task inbox points at it; the drawer's next step shows the proposal
  await staff.page.getByTestId("task-inbox").locator("summary").click();
  await staff.page.getByTestId("task-inbox").getByText("Review the customer's proposed changes").first().waitFor();
  const card = await openOrder(staff.page, "JJ-2026-0144");
  expect((await card.innerText()).includes("Wood: Gmelina -> Mahogany"), "drawer shows the exact diff");
  await card.getByTestId("next-step").getByRole("button", { name: /Review & send revised quote/ }).click();
  await staff.page.fill("#q-price", "14500");
  await staff.page.fill("#q-note", "+₱3,500 for Mahogany and the wider hutch");
  await staff.page.getByRole("button", { name: "Send revised quote" }).click();
  await staff.page.getByText("Revised quote sent.").first().waitFor();
  await staff.page.screenshot({ path: `${SHOTS}/staff-after-proposal-desktop.png`, fullPage: false });
  // Jocelyn has no account yet, so staff send her a fresh review link for the re-issued quotation
  await staff.page.goto("/staff");
  const again = await openOrder(staff.page, "JJ-2026-0144");
  await again.getByRole("tab", { name: "Quotation & Revisions" }).click();
  staff.page.once("dialog", (d) => d.accept());
  await again.getByRole("button", { name: "Resend review link" }).click();
  await staff.page.getByText("A new single-use review link was emailed to the customer.").first().waitFor();
  await staff.ctx.close();

  // the customer opens the NEW link and accepts revision 3
  await openReview(page, await inboxLink(page, "jocelyn.tan@example.com"));
  await page.getByText("Quotation · revision 3").waitFor();
  await page.getByRole("button", { name: "Accept Quote & Confirm Specifications" }).click();
  expect((await page.getByRole("dialog").innerText()).includes("₱14,500"), "dialog shows revised price");
  await page.getByTestId("accept-specification").check();
  await page.getByTestId("accept-quotation").check();
  await page.getByRole("dialog").getByRole("button", { name: "Accept quote & confirm" }).click();
  await page.getByTestId("review-accepted").waitFor();
  await ctx.close();
});

await step("online order: design → order slip → staff confirm → create password → quotation → accept + terms → GCash payment → staff verify", async () => {
  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto("/customer/login");
  await page.getByTestId("option-2").click();
  await page.waitForURL(/\/customer\/customize/);
  // the customization assistant fills the designer from a plain description (and can be undone)
  await page.fill("#assistant-text", "3 door kitchen base counter, 150 x 85 x 55 cm, mahogany, walnut, needed before Christmas");
  await page.getByTestId("assistant-apply").click();
  await page.getByTestId("preview-updated").first().waitFor({ timeout: 5000 }); // the 3D view highlights what the description changed
  const understood = await page.getByTestId("assistant-result").innerText();
  expect(/Kitchen \/ Wall Cabinet/.test(understood) && understood.includes("150 × 85 × 55 cm") && understood.includes("Mahogany") && understood.includes("Walnut Stain"), `assistant result: ${understood}`);
  expect((await page.inputValue('input[name="width_cm"]')) === "150" && (await page.inputValue('input[name="depth_cm"]')) === "55", "assistant filled the size");
  expect((await page.inputValue("#special_instructions")).includes("Christmas"), "timing words are copied to the notes for the shop");
  await page.getByTestId("assistant-photo").waitFor({ state: "detached", timeout: 1000 }).catch(() => {}); // cabinets have no library photo yet
  // the pinned 3D view stays on screen while the options scroll underneath it
  await page.getByTestId("finish-Walnut Stain").scrollIntoViewIfNeeded();
  const pin = await page.getByTestId("configurator-pin").boundingBox();
  const fin = await page.getByTestId("finish-Walnut Stain").boundingBox();
  expect(pin && pin.y >= 0 && pin.y < 120 && fin && fin.y >= pin.y + pin.height - 1, `pinned 3D view stays visible and above the inputs: pin ${JSON.stringify(pin)} chip ${JSON.stringify(fin)}`);
  expect(await page.getByTestId("pinned-preview").isVisible(), "pinned preview visible on phones");
  await page.screenshot({ path: `${SHOTS}/customer-designer-pinned-mobile.png`, fullPage: false });
  await page.getByRole("radio", { name: "3-Door Base Counter" }).check({ force: true });
  await page.getByRole("button", { name: "Submit order" }).click();
  await page.getByText("Your name is required.").first().waitFor();
  await page.fill("#customer_name", "Teodora Bacus");
  await page.fill("#customer_email", "teodora.bacus@example.com");
  await page.fill("#customer_phone", "0900 000 0601");
  await page.selectOption("#municipality", "Lantapan");
  await page.fill("#delivery_address", "Purok 2, Brgy. Songco, near the health center");
  await noHorizontalScroll(page, "customer-request-mobile");
  // a photo of the room (e.g. taken in AR) goes with the order, shrunk to a JPEG in the browser
  const roomShot = await page.screenshot({ type: "png" });
  await page.getByTestId("room-photo-input").setInputFiles({ name: "IMG_0042.PNG", mimeType: "image/png", buffer: roomShot });
  await page.getByText("Photo added").waitFor();
  await page.getByRole("button", { name: "Submit order" }).click();
  await page.getByTestId("request-done").waitFor();
  const reqCode = (await page.getByTestId("request-code").innerText()).trim();
  expect(/^JJ-\d{4}-\d{4}$/.test(reqCode), `permanent JJ code on the slip, got ${reqCode}`);
  expect((await page.getByTestId("request-done").innerText()).includes("waiting for confirmation"), "the slip shows the status");
  expect((await page.getByTestId("request-email").innerText()).trim() === "teodora.bacus@example.com", "emails go to the entered address (no PIN)");
  expect(await page.getByRole("button", { name: "Print or save slip" }).isVisible(), "the slip can be printed");
  await noHorizontalScroll(page, "customer-order-slip-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-order-slip-mobile.png`, fullPage: true });

  // staff confirm the order, then issue the quotation
  const staff = await asPersona("Gilbert Decena", desktop);
  const reqDrawer = await openOrder(staff.page, reqCode);
  const roomHref = await reqDrawer.getByTestId("room-photo-link").getAttribute("href");
  const roomRes = await staff.page.request.get(roomHref);
  expect(roomRes.status() === 200 && roomRes.headers()["content-type"] === "image/jpeg" && (await roomRes.body()).length > 1000, `staff can open the room photo (${roomRes.status()} ${roomRes.headers()["content-type"]})`);
  const anonRes = await (await browser.newContext({ baseURL: BASE })).request.get(roomHref);
  expect(anonRes.status() === 404, "the room photo is never public");
  await reqDrawer.getByTestId("next-step").getByRole("button", { name: "Confirm order" }).click();
  await staff.page.fill("#q-price", "26000");
  await staff.page.fill("#q-fee", "800");
  await staff.page.getByRole("dialog").filter({ has: staff.page.locator("#q-price") }).getByRole("button", { name: "Confirm & issue quotation" }).click();
  await staff.page.getByText(/^Order confirmed and quotation issued\./).first().waitFor();

  // the customer creates a password from the confirmation email, then sees the quotation in their account
  await page.goto(await inboxLink(page, "teodora.bacus@example.com", "/customer/set-password"));
  await page.waitForLoadState("networkidle");
  await page.fill("#password", "Mahogany-Counter-2026");
  await page.fill("#confirm", "Mahogany-Counter-2026");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL(/\/customer\/orders/);
  expect((await page.getByTestId("customer-orders").innerText()).includes(reqCode), "the confirmed order is linked once the inbox owner signs in");
  await page.goto(`/customer/orders/${reqCode}`);
  const accept = page.getByTestId("accept-quotation");
  await accept.waitFor();
  expect((await accept.innerText()).includes("₱26,800"), "total = price + delivery fee");
  await accept.getByText("Installment", { exact: true }).click();
  await accept.getByText("GCash / Maya").click();
  expect(await accept.getByRole("button", { name: "Accept quotation" }).isDisabled(), "both boxes must be ticked");
  await accept.getByText("I checked the design").click();
  await accept.getByText("I accept the quotation").click();
  await noHorizontalScroll(page, "customer-accept-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-accept-mobile.png`, fullPage: false });
  await accept.getByRole("button", { name: "Accept quotation" }).click();
  await page.getByText("Quotation accepted. The owner will review your installment terms").first().waitFor();

  // GCash payment: reference number + receipt photo, saved unverified
  const pay = page.getByTestId("submit-payment");
  await pay.waitFor();
  await pay.locator("#amount").fill("5000");
  await pay.locator("#reference_number").fill("GC 7788 1200");
  await pay.locator("#proof").setInputFiles({ name: "receipt.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  await pay.getByRole("button", { name: "Send payment for checking" }).click();
  await page.getByText("Payment sent.").first().waitFor();
  await page.getByTestId("customer-payments").getByText("Being checked").waitFor();
  await page.screenshot({ path: `${SHOTS}/customer-payment-mobile.png`, fullPage: false });

  // staff open the receipt (never public) and verify it
  await staff.page.goto("/staff");
  const drawer = await openOrder(staff.page, reqCode);
  await drawer.getByRole("tab", { name: "Payments & Gate" }).click();
  const row = drawer.getByTestId("unverified-payment").first();
  const proofHref = await row.getByRole("link", { name: "Open receipt" }).getAttribute("href");
  expect((await staff.page.request.get(proofHref)).status() === 200, "staff can open the receipt");
  expect((await page.request.get(proofHref)).status() === 404, "a customer session cannot fetch receipts by URL");
  staff.page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: /^Verify/ }).click();
  await staff.page.getByText("Payment verified by Gilbert Decena.").first().waitFor(); // the toast names the verifier
  await drawer.getByTestId("verified-by").filter({ hasText: "Verified by Gilbert Decena" }).first().waitFor();
  await staff.ctx.close();
  await page.reload();
  await page.getByTestId("customer-payments").getByText("Verified").waitFor();
  await ctx.close();
});

await step("live sync: staff see a new quote request without reload; no false toast on an internal edit; customer update keeps dialog, typed text and 3D view; offline -> reconcile once", async () => {
  const gl = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}) });
  const live = (p) => p.locator('[data-testid="live-status"][data-status="live"]').first();
  try {
    // staff dashboard, connected
    const sctx = await gl.newContext({ ...desktop, baseURL: BASE });
    const staff = await sctx.newPage();
    await staff.goto("/login");
    await staff.getByRole("button", { name: "Sign in as Staff" }).click();
    await staff.waitForURL(/\/staff$/);
    await live(staff).waitFor({ timeout: 15000 });
    expect((await live(staff).innerText()).includes("Live Sync Active"), "Live Sync Active label");
    const dot = await live(staff).evaluate((el) => getComputedStyle(el.querySelector("span")).backgroundColor);
    expect(dot === "rgb(196, 138, 90)", `Caramel #C48A5A indicator, got ${dot}`);
    await staff.evaluate(() => { window.__noReload = 1; });

    // a customer sends a quote request from another browser
    const rctx = await gl.newContext({ ...mobile, baseURL: BASE });
    const rp = await rctx.newPage();
    await rp.goto("/customer/customize");
    await rp.getByTestId("cat-Kitchen / Wall Cabinet").click();
    await rp.getByRole("radio", { name: "3-Door Base Counter" }).check({ force: true });
    await rp.getByRole("button", { name: "150 × 85 × 55 cm" }).click();
    await rp.getByTestId("wood-Mahogany").click();
    await rp.getByTestId("finish-Walnut Stain").click();
    await rp.fill("#customer_name", "Liza Live");
    await rp.fill("#customer_email", "liza.live@example.com");
    await rp.fill("#customer_phone", "0900 000 0777");
    await rp.selectOption("#municipality", "Lantapan");
    await rp.fill("#delivery_address", "Purok 3, Brgy. Songco");
    await rp.getByRole("button", { name: "Submit order" }).click();
    const liveCode = (await rp.getByTestId("request-code").innerText()).trim();
    await rctx.close();
    await staff.getByText("New online order").first().waitFor({ timeout: 15000 });
    expect((await staff.locator("[data-sonner-toast]", { hasText: "New online order" }).first().innerText()).includes(liveCode), "toast names the new order");
    await staff.locator(`[data-testid="queue-row"][data-code="${liveCode}"]`).waitFor({ timeout: 10000 });
    expect((await staff.evaluate(() => window.__noReload)) === 1, "updated in place, no full page reload");

    // the owner makes an internal edit (re-prioritises): staff get no false "quotation accepted" toast
    const owner = await asPersona("Mr. Vincris Lelis", desktop);
    await owner.page.goto("/owner/craftsmen");
    await owner.page.getByTestId("planning-board").locator("ol > li").nth(1).getByRole("button", { name: "Move up" }).click();
    await owner.page.waitForLoadState("networkidle");
    await staff.waitForTimeout(6000);
    expect((await staff.getByText("Quotation accepted").count()) === 0, "an internal edit never announces a quotation acceptance");

    // signed-in customer watching JJ-2026-0145 with the 3D preview and an open dialog with typed text
    const cctx = await gl.newContext({ ...desktop, baseURL: BASE, reducedMotion: "reduce" });
    const cust = await cctx.newPage();
    await cust.goto("/customer/login");
    await cust.getByTestId("demo-customer-login").click();
    await cust.waitForURL(/\/customer\/orders/);
    await cust.goto("/customer/orders/JJ-2026-0145");
    await live(cust).waitFor({ timeout: 15000 });
    const canvas = cust.locator('[data-testid="preview-3d"] canvas').first();
    await canvas.waitFor({ timeout: 20000 });
    await canvas.evaluate((c) => { c.dataset.liveMark = "kept"; });
    const box = await canvas.boundingBox();
    await cust.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await cust.mouse.down();
    await cust.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 }); // turn the turntable
    await cust.mouse.up();
    await cust.getByRole("button", { name: "Request Post-Confirmation Change / Repair" }).click();
    await cust.fill("#description", "Please keep this unsaved text");

    // meanwhile the craftsman finishes the build
    const craft = await asPersona("Nolito Remulta");
    await craft.page.getByRole("tab", { name: /In Progress/ }).click();
    const job = craft.page.locator("li", { hasText: "JJ-2026-0145" }).first();
    await job.getByRole("button", { name: "Mark Ready for Owner Inspection" }).click();
    for (const b of await craft.page.getByRole("dialog").getByRole("checkbox").all()) await b.check();
    await craft.page.getByRole("dialog").getByRole("button", { name: "Send to owner" }).click();
    await craft.page.getByText("Moved to “Completed / For Inspection”").waitFor();
    await craft.ctx.close();

    await cust.getByText("JJ-2026-0145 is now Completed / For Inspection.").first().waitFor({ timeout: 15000 });
    await cust.waitForTimeout(1500);
    expect(await cust.getByRole("dialog").isVisible(), "the open dialog is not closed by a live update");
    expect((await cust.inputValue("#description")) === "Please keep this unsaved text", "unsaved text is kept");
    await cust.keyboard.press("Escape");
    await cust.getByText("Building is done. The owner is checking the quality.").waitFor({ timeout: 10000 }); // applied once the dialog closed
    expect((await canvas.evaluate((c) => c.dataset.liveMark)) === "kept", "the 3D canvas (and its camera) was not remounted");

    // the customer's connection drops; the owner passes inspection meanwhile; on reconnect: reconcile, one toast
    await cctx.setOffline(true);
    await cust.locator('[data-testid="live-status"][data-status="offline"]').waitFor({ timeout: 10000 });
    expect((await cust.getByTestId("live-status").innerText()).includes("Offline"), "Offline shown");
    const insp = owner.page.locator("li", { hasText: "Quality inspection" }).filter({ hasText: "JJ-2026-0145" }).first();
    await owner.page.goto("/owner"); // inspections are decided on the dashboard
    await insp.getByRole("button", { name: "Pass" }).click();
    await owner.page.getByRole("button", { name: "Passed — ready for delivery" }).click();
    await owner.page.getByText("Inspection passed").waitFor();
    await owner.ctx.close();
    await cust.waitForTimeout(2000);
    expect((await cust.getByText("Your furniture passed inspection").count()) === 0, "nothing changes while offline");
    await cctx.setOffline(false);
    await live(cust).waitFor({ timeout: 15000 });
    await cust.getByText("JJ-2026-0145 is now Ready for Delivery.").first().waitFor({ timeout: 15000 });
    await cust.getByText("Your furniture passed inspection and is ready for delivery.").waitFor({ timeout: 10000 });
    await cust.waitForTimeout(5000); // a few more polls: the reconciled update must not be announced again
    const n = await cust.evaluate(() => (window.__jjLiveToasts ?? []).filter((k) => k.includes(":Ready for Delivery:")).length);
    expect(n === 1, `reconciled update announced exactly once, got ${n}`);
    await cust.screenshot({ path: `${SHOTS}/live-sync-customer-desktop.png`, fullPage: false });
    await sctx.close();
    await cctx.close();
  } finally {
    await gl.close();
  }
});

await step("3D turntable: exact W×H×D labels, non-blocking warning, NULL → 2D, no-WebGL → 2D, clean unmount", async () => {
  const gl = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}) });
  const ctx = await gl.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/customer/customize");
  await page.getByTestId("cat-Living Room Set").click();
  await page.getByTestId("preview-3d").waitFor({ timeout: 20000 });
  expect((await page.getByTestId("preview-3d").innerText()).includes("Illustrative 3D Preview — Reference Aid Only (Not a Manufacturing Drawing)"), "3D disclaimer");
  expect((await page.getByTestId("spin-toggle").innerText()).includes("3D Spin"), "reduced motion: auto-spin starts paused");
  for (const [id, text] of [["dim-w", "W 180 cm"], ["dim-h", "H 85 cm"], ["dim-d", "D 75 cm"]])
    expect((await page.getByTestId(id).innerText()).trim() === text, `${id} label should read ${text}`);
  expect((await page.locator("[data-testid=preview-3d]").innerText()).includes("165 cm") === false, "no human figure in the 3D view");
  // AR: bottom-left button -> full-screen view; a computer has no AR, so it says to use a phone
  await page.getByTestId("ar-open").first().click();
  await page.getByTestId("ar-viewer").waitFor();
  await page.getByTestId("ar-unsupported").waitFor();
  expect((await page.getByTestId("ar-unsupported").innerText()).includes("Open this page on your phone"), "desktop: AR points to the phone");
  await page.keyboard.press("Escape");
  await page.getByTestId("ar-viewer").waitFor({ state: "detached" });
  // new furniture types with details: a chest of drawers with one more drawer
  await page.getByTestId("cat-Drawer Cabinet").click();
  await page.getByTestId("opt-drawers-plus").click();
  expect((await page.inputValue('input[type=hidden][name="design_variant"]')) === "Chest of Drawers · 6 drawers", "the drawer count is part of the design");
  await page.getByTestId("preview-3d").waitFor();
  await page.getByTestId("cat-Living Room Set").click();
  await page.fill('input[name="width_cm"]', "30");
  await page.getByTestId("feasibility-warning").first().waitFor();
  expect((await page.inputValue('input[name="width_cm"]')) === "30", "entered width is kept exactly (no clamping)");
  expect((await page.getByTestId("dim-w").innerText()).trim() === "W 30 cm", "3D label shows the entered width");
  await page.screenshot({ path: `${SHOTS}/preview-3d-desktop.png`, fullPage: false });
  await page.fill('input[name="width_cm"]', "");
  await page.getByText("Dimensions Pending Clarification").first().waitFor();
  expect((await page.getByTestId("preview-3d").count()) === 0, "missing W/H/D never renders a guessed 3D model");
  expect(errors.length === 0, `no runtime errors switching 3D -> 2D: ${errors.join(" | ")}`);
  await ctx.close();
  await gl.close();

  const noGl = await chromium.launch({ args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"], ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}) });
  const ctx2 = await noGl.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE });
  const p2 = await ctx2.newPage();
  const errors2 = [];
  p2.on("pageerror", (e) => errors2.push(e.message));
  await p2.goto("/customer/customize");
  await p2.getByTestId("cat-Dining Table").click();
  await p2.locator('figure[aria-label="Illustrative furniture preview"] svg').first().waitFor();
  expect((await p2.getByTestId("preview-3d").count()) === 0 && errors2.length === 0, "WebGL off: 2D SVG preview, no crash");
  await ctx2.close();
  await noGl.close();
});

await step("security: craftsman cannot open office or driver pages", async () => {
  const { page, ctx } = await asPersona("Nolito Remulta");
  for (const path of ["/owner", "/staff", "/driver"]) {
    await page.goto(path);
    expect(page.url().endsWith("/craftsman"), `${path} should bounce to /craftsman, got ${page.url()}`);
  }
  const r = await page.request.get("/api/driver/manifest");
  expect(r.status() === 403, `manifest API should be 403 for craftsman, got ${r.status()}`);
  await ctx.close();
});

await step("theme: dark and premium black render with their palettes", async () => {
  const { page, ctx } = await asPersona("Mr. Vincris Lelis");
  await page.getByRole("button", { name: "Switch to Dark mode" }).click();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg === "rgb(43, 29, 23)", `dark background expected Espresso #2B1D17, got ${bg}`);
  await page.screenshot({ path: `${SHOTS}/owner-dark-mobile.png`, fullPage: false });
  // Premium black: true black canvas with champagne-gold actions
  await page.getByRole("button", { name: "Switch to Premium black mode" }).click();
  const bgP = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bgP === "rgb(11, 11, 12)", `premium background expected #0B0B0C, got ${bgP}`);
  expect(await page.evaluate(() => document.documentElement.classList.contains("premium") && localStorage.getItem("theme") === "premium"), "premium theme applied and remembered");
  await page.screenshot({ path: `${SHOTS}/owner-premium-mobile.png`, fullPage: false });
  await ctx.close();
});

await browser.close();
console.log(results.join("\n"));
console.log(failures ? `\n${failures} E2E step(s) FAILED` : "\nALL E2E STEPS PASSED");
process.exit(failures ? 1 : 0);
