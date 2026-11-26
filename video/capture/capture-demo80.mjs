// Records the two new shots of the "five roles" cut (DemoRoles) from the REAL app, curated demo data:
//   d80-cust  — the customer's phone from "Set your password" to accepting the quotation
//   d80-craft — the craftsman's phone: job card, parts list, every checklist item ticked, sent to the owner
// The other shots reuse the d70 clips (same fresh demo, same order JJ-2026-1006).
//
//   1. start the app on a fresh in-memory demo:   cd .. && npm run build && PORT=3100 npm start
//   2. node video/capture/capture-demo60.mjs        (BASE_URL defaults to http://localhost:3100)
//
// Customer and owner screens that must show live sync are recorded at the same time
// (two browsers on one server), so every "it appears on the other side" moment is real.
// Output: video/public/clips/d60-*.mp4 + .json (clicks and zoom boxes on the clip clock).
import { chromium, Recorder, actor, CURSOR_SCRIPT } from "./recorder.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const ONLY = process.env.ONLY?.split(",");
const ZOOM = 4 / 3; // 1920x1080 viewport laid out like 1440x810
const CUSTOMER = { name: "Maria Santos", email: "maria.santos.demo@example.com", phone: "0900 000 0315", address: "Purok 3, Brgy. Lumbo, near the chapel", password: "Narra-Chest-2026" };
const manilaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const plusDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// one browser per role: each gets its own GPU (SwiftShader) process, so concurrent recordings
// run in parallel instead of sharing one renderer
const launch = () => chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"] });
const browsers = [];
async function desktop() {
  const browser = await launch(); browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, baseURL: BASE, reducedMotion: "no-preference" });
  await ctx.addInitScript((z) => {
    localStorage.setItem("theme", "dark");
    const apply = () => { document.documentElement.style.zoom = String(z); };
    apply(); document.addEventListener("DOMContentLoaded", apply);
  }, ZOOM);
  await ctx.addInitScript(CURSOR_SCRIPT);
  // the cursor and click ripples are drawn by the editor at 60 fps from the logged moves
  await ctx.addInitScript(() => { sessionStorage.setItem("rec-cursor-hidden", "1"); window.__recNoRipple = true; });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}
async function phone() {
  const browser = await launch(); browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, baseURL: BASE, reducedMotion: "no-preference" });
  await ctx.addInitScript(() => localStorage.setItem("theme", "dark"));
  await ctx.addInitScript(CURSOR_SCRIPT);
  await ctx.addInitScript(() => sessionStorage.setItem("rec-cursor-hidden", "1")); // phones: touch ripples only
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}
const signIn = async (page, account) => {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${account}` }).click();
  await page.waitForLoadState("networkidle");
};
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});
const want = (name) => !ONLY || ONLY.includes(name);
const smoothScroll = (page, y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y);
async function center(page, loc, wait = 900) {
  const top = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); return window.scrollY + r.top + r.height / 2 - window.innerHeight / 2; });
  await smoothScroll(page, Math.max(0, top)); await page.waitForTimeout(wait);
}
async function openDrawer(page, a, code) {
  await a.type(page.getByTestId("queue-search"), code, { delay: 40 });
  await a.click(page.locator(`[data-testid="queue-row"][data-code="${code}"], [data-testid="queue-card"][data-code="${code}"]`).filter({ visible: true }).first(), { label: "row" });
  const d = page.getByTestId("order-drawer");
  await d.getByRole("heading", { name: code }).waitFor();
  return d;
}

let code = "";
const results = [];
try {
  const cust = await desktop();
  const owner = await desktop();
  await signIn(owner.page, "Owner");
  const cphone = await phone();
  const op = owner.page;
  const cp = cphone.page;
  const openOrder = async () => {
    await op.goto("/owner/orders"); await settle(op);
    await op.getByTestId("queue-search").fill(code);
    await op.locator(`[data-testid="queue-row"][data-code="${code}"], [data-testid="queue-card"][data-code="${code}"]`).filter({ visible: true }).first().click();
    const d = op.getByTestId("order-drawer"); await d.getByRole("heading", { name: code }).waitFor();
    return d;
  };

  // off camera: the customer designs and submits; the owner confirms and quotes
  {
    const { page } = cust;
    await page.goto("/customer/login"); await page.getByTestId("option-2").click();
    await page.waitForURL(/\/customer\/customize/); await settle(page); await page.waitForTimeout(1200);
    await page.fill("#assistant-text", "Chest of drawers with 6 drawers, narra, dark espresso finish, 90 x 120 x 45 cm");
    await page.getByTestId("assistant-apply").click();
    await page.getByTestId("preview-updated").first().waitFor({ timeout: 8000 }).catch(() => {});
    await page.getByTestId("opt-drawers-plus").click();
    await page.getByTestId("finish-Walnut Stain").click();
    await page.locator("#customer_name").fill(CUSTOMER.name);
    await page.locator("#customer_email").fill(CUSTOMER.email);
    await page.locator("#customer_phone").fill(CUSTOMER.phone);
    await page.selectOption("#municipality", "Valencia City");
    await page.locator("#delivery_address").fill(CUSTOMER.address);
    await page.getByRole("button", { name: "Submit order" }).first().click();
    await page.getByTestId("request-done").waitFor();
    code = (await page.getByTestId("request-code").innerText()).trim();
    const d = await openOrder();
    await d.getByTestId("next-step").getByRole("button", { name: "Confirm order" }).click();
    await op.fill("#q-price", "18500");
    await op.getByRole("dialog").filter({ has: op.locator("#q-price") }).getByRole("button", { name: "Confirm & issue quotation" }).click();
    await op.getByText(/^Order confirmed and quotation issued\./).first().waitFor();
  }

  // ---------------------------- the customer: Set your password -> the quotation -> accept
  {
    await cp.goto("/demo/inbox"); await settle(cp);
    const item = cp.getByTestId("inbox-item").filter({ hasText: CUSTOMER.email }).filter({ has: cp.locator('a[href^="/customer/set-password"]') }).first();
    await item.waitFor({ timeout: 20_000 });
    await cp.goto(await item.locator('a[href^="/customer/set-password"]').first().getAttribute("href")); await settle(cp); await cp.waitForTimeout(800);
    const rec = new Recorder(cp, "d80-cust", { scale: 2 }); await rec.start(); const a = actor(cp, rec);
    await a.wait(0.8);
    await a.type(cp.locator("#password"), CUSTOMER.password, { delay: 70, label: "password" });
    await a.type(cp.locator("#confirm"), CUSTOMER.password, { delay: 40, label: "confirm" });
    await a.click(cp.getByRole("button", { name: "Save password" }), { label: "save" });
    await cp.waitForURL(/\/customer\/orders/); await settle(cp);
    rec.mark("chime", { label: "signed-in" });
    code = code.replace(/^DR-(\d{4})$/, `JJ-${new Date().getFullYear()}-$1`);
    await a.wait(1.0);
    await a.click(cp.getByTestId("customer-orders").getByText(code).first(), { label: "order" });
    await cp.waitForURL(new RegExp(code)); await settle(cp);
    rec.mark("order-page");
    await a.wait(1.0);
    const accept = cp.getByTestId("accept-quotation");
    await center(cp, accept, 1100);
    await a.click(accept.getByText("Installment", { exact: true }), { label: "installment" });
    await a.click(accept.getByText("Cash at the shop"), { label: "cash" });
    await a.click(accept.getByText("I checked the design"), { label: "check1", ms: 400 });
    await a.click(accept.getByText("I accept the quotation"), { label: "check2", ms: 400 });
    await a.click(accept.getByRole("button", { name: "Accept quotation" }), { label: "accept" });
    await cp.getByText(/Quotation accepted/).first().waitFor();
    rec.mark("chime", { label: "accepted" });
    await a.wait(2.0);
    results.push(await rec.stop());
  }

  // off camera: the owner approves the plan and assigns Nolito
  {
    const d = await openOrder();
    await d.getByTestId("approve-installment").getByRole("button").click();
    await op.getByText("Installment plan approved.").first().waitFor();
    await d.getByTestId("next-step").getByRole("button", { name: "Release to workshop" }).click();
    await op.locator("#assigned_craftsman_id").selectOption({ label: "Nolito Remulta" }).catch(() => {});
    await op.getByRole("dialog").last().getByRole("button", { name: "Start production" }).click();
    await op.getByText("Released to the workshop.").first().waitFor();
  }

  // ------------- the craftsman: job card (3D + parts list), ticks every check, sends to the owner
  {
    const cr = await phone();
    await signIn(cr.page, "Craftsman");
    const pg = cr.page;
    await pg.getByRole("tab", { name: /In Progress/ }).click();
    const job = pg.locator("li", { hasText: code }).first();
    await job.waitFor(); await center(pg, job, 500);
    const rec = new Recorder(pg, "d80-craft", { scale: 2 }); await rec.start(); const a = actor(pg, rec);
    await a.focus(job, "job");
    await a.wait(1.0);
    const parts = job.getByTestId("parts-list").locator("summary");
    await a.click(parts, { label: "parts" });
    await a.wait(0.4);
    await center(pg, job.getByTestId("parts-list"), 900);
    await a.wait(1.6);
    await a.click(parts, { label: "parts-close" });
    await center(pg, job.getByRole("button", { name: "Mark Ready for Owner Inspection" }), 600);
    await a.click(job.getByRole("button", { name: "Mark Ready for Owner Inspection" }), { label: "ready" });
    const dlg = pg.getByRole("dialog");
    await dlg.waitFor();
    let i = 0;
    for (const box of await dlg.getByRole("checkbox").all()) { await a.click(box, { label: `check-${++i}`, ms: 380, after: 0.25 }); }
    await a.wait(0.4);
    await a.click(dlg.getByRole("button", { name: "Send to owner" }), { label: "send" });
    await pg.getByText("Moved to “Completed / For Inspection”").first().waitFor();
    rec.mark("chime", { label: "sent" });
    await a.wait(2.0);
    results.push(await rec.stop());
    await cr.ctx.close();
  }
} finally {
  console.log(JSON.stringify(results.map((r) => ({ name: r.name, duration: r.duration, frames: r.frames, events: r.events.length })), null, 1));
  console.log("order:", code);
  await Promise.all(browsers.map((b) => b.close()));
}
