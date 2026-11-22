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

async function asPersona(name, opts = mobile) {
  const ctx = await browser.newContext({ ...opts, baseURL: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.push(`warn - page error (${name}): ${e.message}`));
  await page.goto("/");
  await page.getByRole("button", { name: `Enter as ${name}` }).click();
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
async function openReview(page, href) {
  await page.goto(href);
  await page.getByRole("button", { name: "Open my quotation" }).click();
  await page.waitForURL(/\/customer\/review\/quote/);
}
// ---------------------------------------------------------------- staff --
let newOrderCode = "";
await step("staff: Today's Work lists task queues", async () => {
  const { page, ctx } = await asPersona("Gilbert Decena", desktop);
  expect(page.url().endsWith("/staff"), `expected /staff, got ${page.url()}`);
  for (const h of ["Customer quote requests (Option 2)", "Release to workshop (30% verified)", "Record customer acceptance (spec + quote)", "Log 30% down payment", "Verify driver cash handover", "Failed SMS updates"])
    expect(await page.getByRole("heading", { name: h }).isVisible(), `missing section ${h}`);
  await page.screenshot({ path: `${SHOTS}/staff-desktop.png`, fullPage: true });
  await ctx.close();
});

await step("staff: new order form validates (email or walk-in) then saves a DR draft; slip shows the email, no PIN", async () => {
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
  await page.getByRole("radio", { name: "Bookshelf / Divider" }).check({ force: true });
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
  expect(/^DR-\d{4}$/.test(newOrderCode), `draft code expected, got ${newOrderCode}`);
  expect((await page.getByTestId("slip-contact").innerText()).trim() === "rosalie.ompad@example.com", "slip shows the normalized email (no PIN)");
  expect(await page.locator("article svg").first().isVisible(), "QR code on slip");
  await noHorizontalScroll(page, "staff-slip-mobile");
  await page.screenshot({ path: `${SHOTS}/staff-slip-mobile.png`, fullPage: true });

  // record acceptance (spec + quote) from the order page → JJ code + Confirmed
  await page.getByRole("link", { name: "Back to order" }).click();
  await page.getByRole("button", { name: "Record acceptance" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record acceptance" }).click();
  await page.getByText(/Specification \+ quotation of revision \d+ accepted/).first().waitFor();
  await page.waitForLoadState("networkidle");
  const title = await page.locator("h1").innerText();
  expect(/^JJ-\d{4}-0149$/.test(title.trim()), `promoted code expected, got ${title}`);
  newOrderCode = title.trim();

  // Confirmed is not authorization to cut wood: the release is refused until 30% is verified
  await page.getByRole("button", { name: "Release to workshop" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start production" }).click();
  await page.getByText(/verified 30% down payment .* is required before production/).first().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Log payment" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Save payment" }).click();
  await page.getByText("Payment recorded.").first().waitFor();
  await page.getByRole("button", { name: "Release to workshop" }).click();
  expect((await page.getByRole("dialog").innerText()).includes("30% verified ✓"), "release dialog shows the verified gate");
  await page.getByRole("dialog").getByRole("button", { name: "Start production" }).click();
  await page.getByText("Released to the workshop.").first().waitFor();
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
  await page.getByRole("heading", { name: /Option 1 · Log In to Track My Orders/ }).waitFor();
  await page.getByRole("heading", { name: /Option 2 · Customize & Request a Quote/ }).waitFor();
  await noHorizontalScroll(page, "customer-portal-mobile");
  await page.screenshot({ path: `${SHOTS}/customer-portal-mobile.png`, fullPage: true });
  // the dashboard needs a customer session
  await page.goto("/customer/orders");
  await page.waitForURL(/\/customer\/login/);

  // wrong password: generic error (no account enumeration)
  await page.fill("#email", "maria.santos@example.com");
  await page.fill("#password", "wrong-password-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
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
  const setup = await inboxLink(page, "ramon.delacruz@example.com", "/customer/setup-password");
  await page.goto(setup);
  await page.fill("#password", "short");
  await page.fill("#confirm", "short");
  await page.getByRole("button", { name: "Save password" }).click();
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
  const reset = await inboxLink(page, "ramon.delacruz@example.com", "/customer/setup-password");
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
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/customer\/orders/);
  await page.getByTestId("customer-orders").waitFor();
  await ctx.close();
});

await step("customer: staff resend link → propose changes in the review session → staff re-quote → new link → accept", async () => {
  const staff = await asPersona("Gilbert Decena", desktop);
  await staff.page.getByRole("tab", { name: /All Orders/ }).click();
  await staff.page.getByText("JJ-2026-0144").first().click();
  await staff.page.waitForURL(/\/staff\/orders\//);
  expect((await staff.page.getByTestId("customer-email-status").innerText()).includes("unverified"), "email shown as unverified");
  staff.page.once("dialog", (d) => d.accept());
  await staff.page.getByRole("button", { name: "Resend review link" }).click();
  await staff.page.getByText("A new review link was issued").first().waitFor();

  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  const page = await ctx.newPage();
  await openReview(page, await inboxLink(page, "jocelyn.tan@example.com"));
  // mobile preview bar must not cover the inputs it describes
  await page.getByTestId("wood-Mahogany").scrollIntoViewIfNeeded();
  const bar = await page.getByTestId("configurator-bar").boundingBox();
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
  await staff.page.getByRole("heading", { name: "Customer proposed specification changes" }).waitFor();
  const card = staff.page.locator("li", { hasText: "JJ-2026-0144" }).first();
  expect((await card.innerText()).includes("Wood: Gmelina -> Mahogany"), "staff card shows exact diff");
  await card.getByRole("button", { name: /Review & send revised quote/ }).click();
  await staff.page.fill("#q-price", "14500");
  await staff.page.fill("#q-note", "+₱3,500 for Mahogany and the wider hutch");
  await staff.page.getByRole("button", { name: "Send revised quote" }).click();
  await staff.page.getByText("Revised quote sent.").first().waitFor();
  await staff.page.screenshot({ path: `${SHOTS}/staff-after-proposal-desktop.png`, fullPage: false });
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

await step("Option 2: customer designs & requests → staff quotation → customer accepts → 30% gate", async () => {
  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto("/customer/login");
  await page.getByTestId("option-2").click();
  await page.waitForURL(/\/customer\/customize/);
  await page.getByTestId("cat-Kitchen / Wall Cabinet").click();
  await page.getByRole("radio", { name: "3-Door Base Counter" }).check({ force: true });
  await page.getByRole("button", { name: "150 × 85 × 55 cm" }).click();
  await page.getByTestId("wood-Mahogany").click();
  await page.getByTestId("finish-Walnut Stain").click();
  await page.getByRole("button", { name: "Send request for quotation" }).click();
  await page.getByText("Your name is required.").first().waitFor();
  await page.fill("#customer_name", "Teodora Bacus");
  await page.fill("#customer_email", "teodora.bacus@example.com");
  await page.fill("#customer_phone", "0900 000 0601");
  await page.selectOption("#municipality", "Lantapan");
  await page.fill("#delivery_address", "Purok 2, Brgy. Songco, near the health center");
  await noHorizontalScroll(page, "customer-request-mobile");
  await page.getByRole("button", { name: "Send request for quotation" }).click();
  await page.getByTestId("request-done").waitFor();
  const reqCode = (await page.getByTestId("request-code").innerText()).trim();
  expect(/^DR-\d{4}$/.test(reqCode), `request code expected, got ${reqCode}`);
  expect((await page.getByTestId("request-email").innerText()).trim() === "teodora.bacus@example.com", "quotation goes to the entered email (no PIN)");
  await page.screenshot({ path: `${SHOTS}/customer-request-done-mobile.png`, fullPage: false });

  // staff issue the official quotation from the Option 2 queue
  const staff = await asPersona("Gilbert Decena", desktop);
  const reqCard = staff.page.locator("li", { hasText: reqCode }).first();
  await reqCard.getByRole("button", { name: "Issue quotation" }).click();
  await staff.page.fill("#q-price", "26000");
  await staff.page.fill("#q-fee", "800");
  await staff.page.fill("#q-slip", "0161");
  await staff.page.getByRole("button", { name: "Send quotation" }).click();
  await staff.page.getByText("Quotation saved as a new revision.").first().waitFor();
  await staff.ctx.close();

  // the quotation arrives by email; the customer opens the link and accepts (valid 7 days)
  await openReview(page, await inboxLink(page, "teodora.bacus@example.com"));
  await page.getByRole("button", { name: "Accept Quote & Confirm Specifications" }).click();
  expect((await page.getByRole("dialog").innerText()).includes("₱26,800"), "total = price + delivery fee");
  await page.getByTestId("accept-specification").check();
  await page.getByTestId("accept-quotation").check();
  await page.getByRole("dialog").getByRole("button", { name: "Accept quote & confirm" }).click();
  await page.getByTestId("setup-email-sent").waitFor();
  await noHorizontalScroll(page, "customer-request-accepted-mobile");
  await ctx.close();
});

await step("live sync: staff see a new quote request without reload; no false toast on an internal edit; customer update keeps dialog, typed text and 3D view; offline -> reconcile once", async () => {
  const gl = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}) });
  const live = (p) => p.locator('[data-testid="live-status"][data-status="live"]').first();
  try {
    // staff dashboard, connected
    const sctx = await gl.newContext({ ...desktop, baseURL: BASE });
    const staff = await sctx.newPage();
    await staff.goto("/");
    await staff.getByRole("button", { name: "Enter as Gilbert Decena" }).click();
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
    await rp.getByRole("button", { name: "Send request for quotation" }).click();
    const liveCode = (await rp.getByTestId("request-code").innerText()).trim();
    await rctx.close();
    await staff.getByText("New quote request").first().waitFor({ timeout: 15000 });
    expect((await staff.locator("[data-sonner-toast]", { hasText: "New quote request" }).first().innerText()).includes(liveCode), "toast names the new request");
    await staff.locator("li", { hasText: liveCode }).first().waitFor({ timeout: 10000 });
    expect((await staff.evaluate(() => window.__noReload)) === 1, "updated in place, no full page reload");

    // the owner makes an internal edit (re-prioritises): staff get no false "quotation accepted" toast
    const owner = await asPersona("Mr. Vincris Lelis", desktop);
    await owner.page.locator("section", { hasText: "Planning Board · production priority" }).locator("ol > li").nth(1).getByRole("button", { name: "Move up" }).click();
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
    await owner.page.reload();
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
  for (const [id, text] of [["dim-w", "W 180 cm"], ["dim-h", "H 85 cm"], ["dim-d", "D 75 cm"], ["dim-human", "165 cm"]])
    expect((await page.getByTestId(id).innerText()).trim() === text, `${id} label should read ${text}`);
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
  expect(bg === "rgb(20, 16, 13)", `dark background expected #14100D, got ${bg}`);
  await page.screenshot({ path: `${SHOTS}/owner-dark-mobile.png`, fullPage: false });
  await ctx.close();
});

await browser.close();
console.log(results.join("\n"));
console.log(failures ? `\n${failures} E2E step(s) FAILED` : "\nALL E2E STEPS PASSED");
process.exit(failures ? 1 : 0);
