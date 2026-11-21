// Full presentation walkthrough (Section 11.B) performed in a real browser.
// It is both a rehearsal recording and a reliability test: every step must
// succeed on the pre-loaded demo data, or the script exits non-zero.
//
//   BASE_URL=http://localhost:3000 VIEW=desktop node tests/e2e/demo-walkthrough.mjs
//   VIEW=mobile  -> 390x844 phone;  VIDEO_DIR=... to choose where the .webm goes
//
// Captions are drawn by this script only (a pointer-events:none overlay); they
// are not part of the app.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const VIEW = process.env.VIEW === "mobile" ? "mobile" : "desktop";
const SIZE = VIEW === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 720 };
const VIDEO_DIR = process.env.VIDEO_DIR ?? "test-results/demo-video";
const SLOW = Number(process.env.SLOW_MO ?? 220);
const PAUSE = Number(process.env.PAUSE_SCALE ?? 1);
mkdirSync(VIDEO_DIR, { recursive: true });

const manilaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const browser = await chromium.launch({ slowMo: SLOW });
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  isMobile: VIEW === "mobile",
  hasTouch: VIEW === "mobile",
  baseURL: BASE,
  recordVideo: { dir: VIDEO_DIR, size: SIZE },
});
// Caption overlay survives navigations (stored in sessionStorage).
await context.addInitScript(() => {
  const draw = () => {
    const text = sessionStorage.getItem("demo-caption");
    let el = document.getElementById("demo-caption");
    if (!text) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;pointer-events:none;" +
        "max-width:92vw;background:rgba(12,10,9,.88);color:#fff;font:600 15px/1.35 system-ui,sans-serif;padding:8px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3);text-align:center";
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
  };
  window.__drawCaption = draw;
  document.addEventListener("DOMContentLoaded", draw);
  setTimeout(draw, 50);
});
const page = await context.newPage();
page.on("dialog", (d) => d.accept()); // confirm() prompts: reset demo data, verify cash
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const log = [];
const t0 = Date.now();
const stamp = () => { const s = Math.round((Date.now() - t0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
async function caption(text) {
  log.push(`${stamp()}  ${text}`);
  await page.evaluate((t) => { sessionStorage.setItem("demo-caption", t); window.__drawCaption?.(); }, text);
}
const pause = (ms) => page.waitForTimeout(ms * PAUSE);
async function checkLayout(label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (sw > iw + 1) throw new Error(`${label}: horizontal scroll (${sw}px content on ${iw}px screen)`);
  if (await page.getByText(/Application error|Something went wrong on the server|404/).count()) throw new Error(`${label}: error screen`);
}
const PORTAL = { Owner: "/owner", Staff: "/staff", Craftsmen: "/craftsman", "Delivery Driver": "/driver", Customer: "/customer/login" };
async function role(name) {
  await page.getByRole("navigation", { name: "Switch demo role" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  // a signed-in customer is sent straight on from the login page to their orders
  await page.waitForURL((u) => u.pathname === PORTAL[name] || (name === "Customer" && u.pathname === "/customer/orders"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}
async function toast(text) {
  await page.getByText(text).first().waitFor({ timeout: 15000 });
}
async function scrollTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  await pause(600);
}

let newCode = "";
let orderId = "";
try {
  // ---------------------------------------------------------------- 0. reset
  await page.goto("/");
  await page.getByRole("button", { name: "Reset Demo Data" }).click();
  await toast("Demo data restored");
  await page.reload();

  // ---------------------------------------------------- 1. Introduction 0:45
  await page.goto("/about");
  await caption("1 · Introduction — JJ Furniture Shop and Enterprises, Valencia City, Bukidnon");
  await checkLayout("about");
  await pause(3500);
  await scrollTo(page.getByRole("heading", { name: "What we found in the Discover phase" }));
  await caption("Discover phase: paper slips, verbal priorities, delivery gaps, repeated follow-ups");
  await pause(4000);
  await scrollTo(page.getByRole("heading", { name: "One record, five portals" }));
  await caption("Concept 3: one shared order record, five browser portals, 7 standard stages");
  await pause(3500);
  await scrollTo(page.getByRole("heading", { name: "The 7-stage order lifecycle" }));
  await pause(3000);

  // ----------------------------------------------------- 2. Staff portal 1:30
  await role("Staff");
  await caption("2 · Staff portal (S-01) — Gilbert's Today's Work queues");
  await checkLayout("staff today");
  await pause(2500);
  await page.getByRole("link", { name: "New Order" }).first().click();
  await page.waitForURL(/\/staff\/new/);
  await caption("+ New Order: copy the handwritten paper slip");
  await page.fill("#paper_slip_number", "0149");
  await page.fill("#customer_name", "Rosalinda Abellana");
  await page.fill("#customer_phone", "0900 000 0149");
  await page.fill("#customer_email", "rosalinda.abellana@example.com");
  await page.selectOption("#municipality", "Lantapan");
  await page.fill("#delivery_fee", "800");
  await page.fill("#delivery_address", "Purok 3, Brgy. Poblacion, beside the chapel");
  await caption("Real-time configurator: category, design, size preset, wood and finish — preview updates live");
  await scrollTo(page.getByText("Furniture category").first());
  await page.getByTestId("cat-Dining Table").click();
  await page.getByRole("radio", { name: "6-Seater Classic" }).check({ force: true });
  await page.getByRole("button", { name: "180 × 76 × 90 cm" }).click();
  await page.getByTestId("wood-Gmelina").click();
  await pause(1200);
  await page.getByTestId("wood-Mahogany").click();
  for (const f of ["Gloss White", "Dark Espresso", "Walnut Stain"]) {
    await page.getByTestId(`finish-${f}`).click();
    await pause(900);
  }
  await page.fill("#furniture_price", "24000");
  await scrollTo(page.locator("dl[aria-live]"));
  await caption("Provincial delivery (Lantapan): 30% down ₱7,200 · 70% ₱16,800 · fee ₱800 → collect ₱17,600");
  await pause(4000);
  await page.selectOption("#municipality", "Valencia City");
  await scrollTo(page.locator("dl[aria-live]"));
  await caption("Inside Valencia City the delivery fee becomes FREE (₱0) automatically");
  await pause(3500);
  await page.getByRole("button", { name: "Save order" }).click();
  await page.waitForURL(/\/slip\?new=1/);
  newCode = (await page.locator("article .font-mono").first().innerText()).trim();
  orderId = page.url().match(/orders\/([^/]+)\/slip/)[1];
  if (!/^DR-\d{4}$/.test(newCode)) throw new Error(`slip shows ${newCode}`);
  await caption(`Paper slip: Order ID ${newCode}, QR code, two dates — the quotation review link went to the customer's email (no PIN)`);
  await checkLayout("slip");
  await pause(3500);
  await scrollTo(page.getByText("Estimated completion", { exact: false }).first());
  await pause(2500);
  await scrollTo(page.getByText("Collect on delivery", { exact: false }).first());
  await pause(2500);

  // --------------------------------------------------- 3. Customer portal 1:00
  await role("Customer");
  await caption("3 · Customer portal (CU-01) — Option 1: log in with email + password · Option 2: customize & request a quote");
  if (await page.locator("#order_code, #pin").count()) throw new Error("retired Order ID + PIN lookup is still on the page");
  await checkLayout("customer portal");
  await pause(3000);
  await scrollTo(page.getByTestId("option-2"));
  await pause(2500);
  await caption("The quotation arrives by email (demo inbox) with a single-use review link");
  await page.goto("/demo/inbox");
  const mail = page.getByTestId("inbox-item").filter({ hasText: "rosalinda.abellana@example.com" }).first();
  await scrollTo(mail);
  await pause(2500);
  const reviewHref = await mail.locator('a[href^="/customer/review"]').first().getAttribute("href");
  await page.goto(reviewHref);
  await caption("Opening the link verifies the email and opens ONLY this quotation (scanners cannot use it up)");
  await pause(2000);
  await page.getByRole("button", { name: "Open my quotation" }).click();
  await page.waitForURL(/\/customer\/review\/quote/);
  await page.waitForLoadState("networkidle");
  await checkLayout("customer review");
  await pause(2500);
  await caption("While reviewing, the customer can explore woods and finishes live");
  await page.getByTestId("wood-Gmelina").first().click();
  await page.getByText("Your changes:").waitFor();
  await pause(2500);
  await caption("Changing anything would be sent for review — here the customer keeps the quote");
  await page.getByRole("button", { name: "Undo my changes" }).click();
  await pause(1200);
  await caption("Accept Quote & Confirm Specifications — two explicit acceptances: the spec AND the quotation (valid 7 days)");
  await page.getByRole("button", { name: "Accept Quote & Confirm Specifications" }).click();
  await pause(1500);
  await page.getByTestId("accept-specification").check();
  await pause(600);
  await page.getByTestId("accept-quotation").check();
  await pause(1000);
  await page.getByRole("dialog").getByRole("button", { name: "Accept quote & confirm" }).click();
  await page.getByTestId("setup-email-sent").waitFor();
  await caption("Accepted — the customer gets an email to create a password (never a plaintext password)");
  await pause(3000);
  const setupHref = await (async () => {
    await page.goto("/demo/inbox");
    return page.getByTestId("inbox-item").filter({ hasText: "rosalinda.abellana@example.com" }).first()
      .locator('a[href^="/customer/setup-password"]').first().getAttribute("href");
  })();
  await page.goto(setupHref);
  await page.fill("#password", "Narra-Dining-2026");
  await page.fill("#confirm", "Narra-Dining-2026");
  await pause(1200);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL(/\/customer\/orders/);
  await caption("Customer dashboard (email + password): all their orders, 7-stage progress, 3D preview, payments");
  await pause(3500);
  newCode = newCode.replace(/^DR-(\d{4})$/, `JJ-${new Date().getFullYear()}-$1`);
  await caption(`Confirmed — ${newCode} is at stage 2/7, but wood is not cut until the 30% is verified`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(3500);

  // ------------------------- staff: verified 30% -> release to the workshop
  await role("Staff");
  await caption("Staff logs the 30% down payment, then releases the job to the workshop");
  const dp = page.locator("li", { hasText: newCode }).filter({ hasText: "Still needed" }).first();
  await scrollTo(dp);
  await dp.getByRole("button", { name: "Log payment" }).click();
  await pause(1000);
  await page.getByRole("button", { name: "Save payment" }).click();
  await toast("Payment recorded.");
  const rel = page.locator("li", { hasText: newCode }).filter({ has: page.getByRole("button", { name: "Release to workshop" }) }).first();
  await scrollTo(rel);
  await rel.getByRole("button", { name: "Release to workshop" }).click();
  await caption("The server re-checks: verified 30%, accepted latest revision, no price drift, no blocking items");
  await pause(2500);
  await page.getByRole("dialog").getByRole("button", { name: "Start production" }).click();
  await toast("Released to the workshop.");
  await pause(1500);

  // ------------------------------------------- 4a. Craftsmen portal (2:00 total)
  await role("Craftsmen");
  await caption("4 · Craftsmen portal (C-01) — priority-sorted jobs, no prices or phone numbers");
  {
    const html = await page.content();
    const i = html.indexOf("₱");
    if (i >= 0) throw new Error("money shown on craftsman screen: …" + html.slice(Math.max(0, i - 200), i + 40).replace(/\s+/g, " ") + "… url=" + page.url());
  }
  await checkLayout("craftsman");
  const job = () => page.locator("li", { hasText: newCode }).first();
  await caption("Up Next jobs wait for the office's release — craftsmen cannot start production themselves");
  await pause(2500);
  await page.getByRole("tab", { name: /In Progress/ }).click();
  await caption("The released job is In Production. Unsure about a detail? Ask Spec Question");
  await scrollTo(job());
  await job().getByRole("button", { name: "Ask Spec Question" }).click();
  await page.getByRole("textbox", { name: /Your question/ }).fill("Should the table edge be rounded or square?");
  await pause(1200);
  await page.getByRole("button", { name: "Send question" }).click();
  await toast("Sent to the office.");
  await page.getByRole("tab", { name: /For Revision/ }).click();
  await scrollTo(job());
  await pause(1500);
  await caption("Building done → Mark Ready for Owner Inspection (quality checklist)");
  await job().getByRole("button", { name: "Mark Ready for Owner Inspection" }).click();
  for (const box of await page.getByRole("dialog").getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Send to owner" }).click();
  await toast("Moved to “Completed / For Inspection”");
  await pause(1500);

  // ------------------------------------------------------------- 4b. Owner
  await role("Owner");
  await caption("Owner dashboard (O-01) — 8 live KPI cards from the shared record");
  await checkLayout("owner");
  await pause(4000);
  await scrollTo(page.getByRole("heading", { name: "Needs your attention" }));
  await caption("Needs Your Attention: the craftsman's spec question, approvals and inspections");
  await pause(2500);
  const q = page.locator("li", { hasText: "Should the table edge be rounded" }).first();
  await scrollTo(q);
  await q.getByRole("button", { name: "Answer" }).click();
  await page.getByRole("textbox", { name: /Answer/ }).fill("Rounded edges, 1cm radius — confirmed with the customer.");
  await page.getByRole("button", { name: "Send answer to workshop" }).click();
  await toast("Marked resolved.");
  const inst = page.locator("li", { hasText: "Installment Approval" }).first();
  await scrollTo(inst);
  await caption("Approve an installment request (payment exception needs the owner)");
  await inst.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await toast("Marked approved.");
  const board = page.locator("section", { hasText: "Planning Board · production priority" });
  await scrollTo(board.getByRole("heading").first());
  await caption("Planning Board: move jobs up/down or mark Urgent — craftsmen see the same order");
  const target = board.locator("ol > li", { hasText: newCode }).first();
  await scrollTo(target);
  await target.getByRole("button", { name: "Urgent" }).click();
  await toast("Priority set to Urgent.");
  await pause(2500);
  const insp = page.locator("li", { hasText: "Quality inspection" }).filter({ hasText: newCode }).first();
  await scrollTo(insp);
  await caption("Quality inspection passed → Ready for Delivery (stage 5/7)");
  await insp.getByRole("button", { name: "Pass" }).click();
  await page.getByRole("button", { name: "Passed — ready for delivery" }).click();
  await toast("Inspection passed");
  await pause(2000);

  // ---------------------- staff hand-off: 30% down payment + driver schedule
  await role("Staff");
  await caption("Staff schedules Jesse's Multicab for today");
  const sch = page.locator("li", { hasText: newCode }).filter({ has: page.getByRole("button", { name: "Schedule delivery" }) }).first();
  await scrollTo(sch);
  await sch.getByRole("button", { name: "Schedule delivery" }).click();
  await page.selectOption("#driver_id", { label: "Jesse Decena" });
  await page.selectOption("#vehicle_type", "Multicab");
  await page.fill("#scheduled_date", manilaToday);
  await page.selectOption("#time_window", "1:00 PM - 3:00 PM");
  await pause(1000);
  await page.getByRole("dialog").getByRole("button", { name: "Schedule delivery" }).click();
  await toast("Delivery scheduled");
  await pause(1500);

  // ------------------------------------------------ 5. Delivery driver 1:30
  await role("Delivery Driver");
  await page.getByText("Online • Synced").waitFor();
  await caption("5 · Driver portal (D-01) — only Jesse's trips, exact COLLECT ON DELIVERY amounts");
  await checkLayout("driver");
  const trip = () => page.locator("li", { hasText: newCode }).first();
  await scrollTo(trip());
  await pause(3500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await caption("Before leaving the shop: Pre-Load Assignments for Offline Travel");
  await page.getByRole("button", { name: "Pre-Load Assignments for Offline Travel" }).click();
  await toast("saved on this phone for offline travel");
  await pause(1500);
  await caption("No signal on the road: Simulate Offline / Weak Signal");
  await page.getByRole("switch", { name: "Simulate Offline / Weak Signal" }).click();
  await scrollTo(trip());
  await trip().getByRole("button", { name: "Start Trip" }).click();
  await page.getByText("Offline • Saved Locally (1 pending)").waitFor();
  await caption("Mark Delivered & log the cash collected — still offline");
  await scrollTo(trip());
  await trip().getByRole("button", { name: "Mark Delivered & Log Cash Collected" }).click();
  await pause(1200);
  await page.getByRole("button", { name: "Save on phone" }).click();
  await page.getByText("Offline • Saved Locally (2 pending)").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await caption("Honest status: “Saved Locally — Pending Sync”. Nothing claims it reached the server yet");
  await pause(5000);
  await caption("Signal is back → automatic synchronization, new sync timestamp");
  await page.getByRole("switch", { name: "Simulate Offline / Weak Signal" }).click();
  await page.getByText("Online • Synced").waitFor({ timeout: 15000 });
  await pause(3500);
  await page.getByRole("tab", { name: /Done/ }).click();
  await scrollTo(trip());
  await pause(2500);

  // --------------------------------------------------- 6. Final overview 1:00
  await role("Staff");
  await caption("6 · Overview — the driver's cash appears at the shop for handover verification");
  const cash = page.locator("li", { hasText: newCode }).filter({ hasText: "Delivery Balance Collection" }).first();
  await scrollTo(cash);
  await cash.getByRole("button", { name: /Verify ₱/ }).click();
  await toast("Cash handover verified.");
  await page.goto(`/staff/orders/${orderId}`);
  await page.waitForLoadState("networkidle");
  await caption(`${newCode}: all 7 stages complete — Waiting → Confirmed → … → Delivered`);
  await checkLayout("order detail");
  await pause(4000);
  await scrollTo(page.getByText("Status history", { exact: true }));
  await caption("Every step is in the audit trail, including actions synced from the driver's phone");
  await pause(4000);
  await role("Customer");
  await page.waitForURL(/\/customer\/orders/);
  const mine = page.getByTestId("customer-orders");
  await mine.waitFor();
  if (!(await mine.innerText()).includes("Delivered")) throw new Error("customer dashboard should show Delivered");
  await scrollTo(mine);
  await caption("Logged in, the customer sees Delivered on their dashboard without calling the shop");
  await pause(3500);
  await role("Owner");
  await caption("Owner KPIs updated — one shared record, no extra software costs");
  await pause(4500);
  await caption("");
  await pause(500);
} catch (e) {
  await page.screenshot({ path: `${VIDEO_DIR}/FAILED-${VIEW}.png` }).catch(() => {});
  console.error(`WALKTHROUGH FAILED at ${stamp()} (${VIEW}):`, e.message);
  console.log(log.join("\n"));
  await context.close();
  await browser.close();
  process.exit(1);
}
const video = page.video();
await context.close();
await browser.close();
console.log(log.join("\n"));
console.log(`\nWALKTHROUGH PASSED (${VIEW}, ${stamp()} long, order ${newCode})`);
if (errors.length) console.log("page errors:", errors);
console.log("video:", await video.path());
