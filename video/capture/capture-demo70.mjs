// Records the owner relay of the 1:10 demo (Demo70) from the REAL app, curated demo data:
// the owner's laptop drives every step, the customer's phone updates live after each one,
// and the craftsman / rider phones are recorded for their trigger beats.
// (The first 27 s reuse the d60 clips: same fresh demo, same order JJ-2026-1006.)
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
  const top = (page) => page.evaluate(() => window.scrollTo({ top: 0 })).then(() => page.waitForTimeout(500));

  // ------------------------------- off camera: the customer designs and submits (same as Demo60)
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
  }

  // ------------------------------------------------ A. owner confirms + sends the quotation
  {
    const d = await openOrder();
    const rec = new Recorder(op, "d70-quote"); await rec.start(); const a = actor(op, rec);
    await a.focus(d.getByTestId("next-step"), "next-step");
    await a.wait(0.8);
    await a.click(d.getByTestId("next-step").getByRole("button", { name: "Confirm order" }), { label: "confirm" });
    const dlg = op.getByRole("dialog").filter({ has: op.locator("#q-price") });
    await dlg.waitFor();
    await a.type(op.locator("#q-price"), "18500", { delay: 110 });
    await a.wait(0.4);
    await a.click(dlg.getByRole("button", { name: "Confirm & issue quotation" }), { label: "issue" });
    await op.getByText(/^Order confirmed and quotation issued\./).first().waitFor();
    rec.mark("chime", { label: "quoted" });
    await a.wait(2.0);
    results.push(await rec.stop());
  }
  // the customer opens the email link on the phone and sets a password (off camera), then sees the quotation
  {
    await cp.goto("/demo/inbox"); await settle(cp);
    const item = cp.getByTestId("inbox-item").filter({ hasText: CUSTOMER.email }).filter({ has: cp.locator('a[href^="/customer/set-password"]') }).first();
    await item.waitFor({ timeout: 20_000 });
    await cp.goto(await item.locator('a[href^="/customer/set-password"]').first().getAttribute("href")); await settle(cp);
    await cp.fill("#password", CUSTOMER.password); await cp.fill("#confirm", CUSTOMER.password);
    await cp.getByRole("button", { name: "Save password" }).click();
    await cp.waitForURL(/\/customer\/orders/); await settle(cp);
    code = code.replace(/^DR-(\d{4})$/, `JJ-${new Date().getFullYear()}-$1`);
    await cp.goto(`/customer/orders/${code}`); await settle(cp); await cp.waitForTimeout(1000);
    const rec = new Recorder(cp, "d70-c-quote", { scale: 2 }); await rec.start();
    await cp.waitForTimeout(1500);
    await center(cp, cp.getByTestId("accept-quotation"), 1400);
    await cp.waitForTimeout(1200);
    results.push(await rec.stop());
  }

  // ------------------------------- B. trigger: the customer accepts (installment, cash) · owner live
  {
    const d = await openOrder();
    const accept = cp.getByTestId("accept-quotation");
    await center(cp, accept, 500);
    const crec = new Recorder(cp, "d70-accept", { scale: 2 }); const orec = new Recorder(op, "d70-accepted");
    await crec.start(); await orec.start();
    const a = actor(cp, crec);
    await orec.mark("focus", { label: "next-step" });
    await a.wait(0.6);
    await a.click(accept.getByText("Installment", { exact: true }), { label: "installment" });
    await a.click(accept.getByText("Cash at the shop"), { label: "cash" });
    await a.click(accept.getByText("I checked the design"), { label: "check1", ms: 400 });
    await a.click(accept.getByText("I accept the quotation"), { label: "check2", ms: 400 });
    const live = op.waitForFunction(() => /Quotation accepted/.test(document.querySelector('[data-testid="next-step"]')?.textContent ?? ""), null, { timeout: 30_000, polling: 30 }).then(() => orec.mark("chime", { label: "accepted-live" }));
    await a.click(accept.getByRole("button", { name: "Accept quotation" }), { label: "accept" });
    await cp.getByText(/Quotation accepted/).first().waitFor();
    crec.mark("chime", { label: "accepted" });
    await live;
    await a.wait(2.5);
    results.push(await crec.stop()); results.push(await orec.stop());
    // off camera: the installment schedule (4 payments, first due in 15 days)
    await d.getByRole("tab", { name: "Payments & Gate" }).click();
    await op.locator('[name="installment_count"]').selectOption("4");
    await op.locator('[name="installment_first_due"]').fill(plusDays(manilaToday, 15));
    await d.getByTestId("installment-form").getByRole("button", { name: "Save plan" }).click();
    await op.getByText(/Installment plan saved/).first().waitFor();
    await d.getByRole("tab", { name: "Overview & 3D Spec" }).click();
  }

  // ------------- C. owner approves the plan and assigns the craftsman · customer: In Production
  {
    await cp.reload(); await settle(cp); await top(cp);
    const d = op.getByTestId("order-drawer");
    const orec = new Recorder(op, "d70-release"); const crec = new Recorder(cp, "d70-c-prod", { scale: 2 });
    await orec.start(); await crec.start();
    const a = actor(op, orec);
    await a.focus(d.getByTestId("next-step"), "next-step");
    await a.wait(0.6);
    await a.click(d.getByTestId("approve-installment").getByRole("button"), { label: "approve" });
    await op.getByText("Installment plan approved.").first().waitFor();
    orec.mark("chime", { label: "approved" });
    await a.wait(1.0);
    await a.click(d.getByTestId("next-step").getByRole("button", { name: "Release to workshop" }), { label: "release" });
    const sel = op.locator("#assigned_craftsman_id");
    await a.click(sel, { label: "craftsman" }).catch(() => {});
    await sel.selectOption({ label: "Nolito Remulta" }).catch(() => {});
    await op.keyboard.press("Escape").catch(() => {});
    await a.wait(0.8);
    const toProd = cp.waitForFunction(() => /is now In Production/i.test(document.body.innerText), null, { timeout: 30_000, polling: 50 }).then(() => crec.mark("chime", { label: "in-production-live" }));
    await a.click(op.getByRole("dialog").last().getByRole("button", { name: "Start production" }), { label: "start" });
    await op.getByText("Released to the workshop.").first().waitFor();
    orec.mark("chime", { label: "released" });
    await toProd;
    await a.wait(2.0);
    results.push(await orec.stop()); results.push(await crec.stop());
  }

  // -------- D. trigger: the craftsman sends it for inspection · owner live · customer live
  {
    const cr = await phone();
    await signIn(cr.page, "Craftsman");
    await op.goto("/owner"); await settle(op);
    await cr.page.getByRole("tab", { name: /In Progress/ }).click();
    const job = cr.page.locator("li", { hasText: code }).first();
    await job.waitFor(); await center(cr.page, job, 500);
    await top(cp);
    const prec = new Recorder(cr.page, "d70-craft", { scale: 2 }); const orec = new Recorder(op, "d70-insp"); const crec = new Recorder(cp, "d70-c-insp", { scale: 2 });
    await prec.start(); await orec.start(); await crec.start();
    const pa = actor(cr.page, prec);
    await pa.focus(job, "job");
    await pa.wait(1.0);
    await pa.click(job.getByRole("button", { name: "Mark Ready for Owner Inspection" }), { label: "ready" });
    for (const box of await cr.page.getByRole("dialog").getByRole("checkbox").all()) await box.check();
    const insp = op.locator("li", { hasText: "Quality inspection" }).filter({ hasText: code }).first();
    const arrived = insp.waitFor({ timeout: 30_000 }).then(() => orec.mark("chime", { label: "inspection-arrived" }));
    const custLive = cp.waitForFunction(() => /Completed \/ For Inspection|being checked|inspection/i.test(document.querySelector("main")?.innerText?.slice(0, 400) ?? ""), null, { timeout: 30_000, polling: 50 }).then(() => crec.mark("chime", { label: "insp-live" })).catch(() => {});
    await pa.click(cr.page.getByRole("dialog").getByRole("button", { name: "Send to owner" }), { label: "send" });
    await cr.page.getByText("Moved to “Completed / For Inspection”").first().waitFor();
    prec.mark("chime", { label: "sent" });
    await arrived; await custLive;
    await pa.wait(3.0);
    results.push(await prec.stop()); results.push(await orec.stop()); results.push(await crec.stop());
    await cr.ctx.close();
  }

  // --------------- E. owner passes the inspection and assigns the rider · customer live
  {
    const insp = op.locator("li", { hasText: "Quality inspection" }).filter({ hasText: code }).first();
    await center(op, insp, 400);
    const orec = new Recorder(op, "d70-pass"); const crec = new Recorder(cp, "d70-c-ready", { scale: 2 });
    await orec.start(); await crec.start();
    const a = actor(op, orec);
    await a.focus(insp, "inspection");
    await a.wait(0.5);
    await a.click(insp.getByRole("button", { name: "Pass" }), { label: "pass" });
    await a.click(op.getByRole("button", { name: "Passed — ready for delivery" }), { label: "passed" });
    await op.getByText("Inspection passed").first().waitFor();
    orec.mark("chime", { label: "ready" });
    await a.wait(1.0);
    orec.mark("cut", { label: "to-orders" });
    const d = await openOrder();
    await a.click(d.getByTestId("next-step").getByRole("button", { name: "Schedule delivery" }), { label: "schedule" });
    const rider = op.locator("#driver_id");
    await a.click(rider, { label: "rider" });
    await rider.selectOption({ label: "Jesse Decena" });
    await op.selectOption("#vehicle_type", "Multicab");
    await op.fill("#scheduled_date", manilaToday);
    await op.selectOption("#time_window", { index: 1 });
    await a.wait(0.4);
    await a.click(op.getByRole("dialog").getByRole("button", { name: "Schedule delivery" }), { label: "schedule-save" });
    await op.getByText(/Delivery scheduled/).first().waitFor();
    orec.mark("chime", { label: "scheduled" });
    await a.wait(3.5);
    results.push(await orec.stop()); results.push(await crec.stop());
    await op.getByTestId("drawer-close").click().catch(() => {});
  }

  // ---------- F. trigger: the rider delivers · owner and customer see "Delivered" live
  {
    const dr = await phone();
    await signIn(dr.page, "Delivery Rider");
    await dr.page.getByText("Online • Synced").waitFor();
    const row = dr.page.locator(`[data-testid="delivery-rows"] li[data-code="${code}"]`).getByTestId("delivery-row");
    await row.waitFor({ timeout: 20_000 });
    await op.goto("/owner/orders"); await settle(op);
    await top(cp);
    const rrec = new Recorder(dr.page, "d70-rider", { scale: 2 }); const orec = new Recorder(op, "d70-o-deliv"); const crec = new Recorder(cp, "d70-c-deliv", { scale: 2 });
    await rrec.start(); await orec.start(); await crec.start();
    const ra = actor(dr.page, rrec);
    await ra.click(row, { label: "open" });
    const detail = dr.page.getByTestId("delivery-detail");
    await ra.click(detail.getByRole("button", { name: "Start Trip" }), { label: "start-trip" });
    await ra.wait(1.4);
    await ra.click(detail.getByRole("button", { name: "Mark Delivered & Log Cash Collected" }), { label: "delivered" });
    await ra.wait(0.5);
    const custLive = cp.waitForFunction(() => /Delivered\. Thank you/.test(document.body.innerText), null, { timeout: 30_000, polling: 50 }).then(() => crec.mark("chime", { label: "delivered-live" }));
    await ra.click(dr.page.getByRole("button", { name: "Save delivery" }), { label: "save" });
    await dr.page.getByText(/Synced \d+ action/).first().waitFor({ timeout: 20_000 }).catch(() => {});
    rrec.mark("chime", { label: "delivered" });
    await custLive;
    await ra.wait(3.0);
    results.push(await rrec.stop()); results.push(await orec.stop()); results.push(await crec.stop());
    await dr.ctx.close();
  }

  // ------------------- G. after delivery: the owner records an installment payment · customer live
  {
    await center(cp, cp.getByText("Your terms:").first(), 500);
    const d = await openOrder();
    await d.getByRole("tab", { name: "Payments & Gate" }).click();
    const logBtn = d.getByRole("button", { name: "Log payment" }).first();
    await center(op, logBtn, 500);
    const orec = new Recorder(op, "d70-pay"); const crec = new Recorder(cp, "d70-c-paid", { scale: 2 });
    await orec.start(); await crec.start();
    const a = actor(op, orec);
    await a.focus(d.getByTestId("installment-plan"), "plan");
    await a.wait(0.6);
    await a.click(logBtn, { label: "log" });
    const pay = op.getByRole("dialog").last();
    await pay.locator("#payment_type").selectOption("Installment / Partial");
    await a.type(pay.locator("#amount"), "4625", { delay: 100 });
    const paidLive = cp.waitForFunction(() => /Payment verified/i.test(document.body.innerText), null, { timeout: 30_000, polling: 50 }).then(() => crec.mark("chime", { label: "paid-live" })).catch(() => {});
    await a.click(pay.getByRole("button", { name: "Save payment" }), { label: "save-payment" });
    await op.getByText("Payment recorded.").first().waitFor();
    orec.mark("chime", { label: "paid" });
    await paidLive;
    await a.wait(3.0);
    results.push(await orec.stop()); results.push(await crec.stop());
  }
} finally {
  console.log(JSON.stringify(results.map((r) => ({ name: r.name, duration: r.duration, frames: r.frames, events: r.events.length })), null, 1));
  console.log("order:", code);
  await Promise.all(browsers.map((b) => b.close()));
}
