// Records the scenes of the 60-second demo (Demo60) from the REAL app, curated demo data.
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

  // ------------------------------------------------ 1. customer designs with the AI + options
  {
    const { page } = cust;
    await page.goto("/customer/login"); await page.getByTestId("option-2").click();
    await page.waitForURL(/\/customer\/customize/); await settle(page); await page.waitForTimeout(1500);
    await center(page, page.locator("#assistant-text"), 600);
    const rec = new Recorder(page, "d60-customize"); await rec.start(); const a = actor(page, rec);
    await a.wait(0.8);
    await a.focus(page.locator("#assistant-text"), "assistant");
    await a.type(page.locator("#assistant-text"), "Chest of drawers with 6 drawers, narra, dark espresso finish, 90 x 120 x 45 cm", { delay: 32 });
    await a.wait(0.3);
    await a.click(page.getByTestId("assistant-apply"), { label: "apply" });
    await page.getByTestId("preview-updated").first().waitFor({ timeout: 8000 }).catch(() => {});
    rec.mark("chime", { label: "ai-built" });
    await a.focus(page.getByTestId("assistant-result"), "understood");
    await a.wait(1.6);
    const preview = page.locator("canvas").first();
    await center(page, preview, 700);
    await a.focus(preview, "preview");
    await a.wait(1.0);
    // fine-tune: one more drawer, then a lighter finish
    const plus = page.getByTestId("opt-drawers-plus");
    await center(page, plus, 600);
    await a.focus(page.getByTestId("design-options"), "options");
    await a.click(plus, { label: "drawer-plus" });
    rec.mark("chime", { label: "drawer" });
    await a.wait(1.2);
    const fin = page.getByTestId("finish-Walnut Stain");
    await center(page, fin, 600);
    await a.click(fin, { label: "finish" });
    await a.wait(1.2);
    // turn the model with a drag
    await center(page, preview, 700);
    await a.focus(preview, "preview2");
    const b = await preview.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height * 0.55;
    await a.moveXY(cx - 100, cy, 700); await a.wait(0.2);
    rec.mark("drag", { x: cx - 100, y: cy });
    await page.mouse.move(cx - 100, cy); await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      const x = cx - 100 + 260 * (i / 16), y = cy + Math.sin(i / 3) * 6;
      rec.mark("move", { x, y, ms: 50 });
      await page.mouse.move(x, y);
    }
    await page.mouse.up();
    await a.wait(1.5);
    results.push(await rec.stop());

    // the same chest, full screen: a crisp turntable shot
    await page.getByTestId("ar-open").first().click();
    await page.getByTestId("ar-viewer").waitFor(); await page.waitForTimeout(2500);
    const vrec = new Recorder(page, "d60-3d"); await vrec.start();
    await page.waitForTimeout(9000);
    results.push(await vrec.stop());
    await page.getByTestId("ar-close").click(); await page.waitForTimeout(600);
  }

  // --------------------------------- 2. customer submits · owner sees it arrive live
  {
    const { page } = cust;
    await page.locator("#customer_name").fill(CUSTOMER.name);
    await page.locator("#customer_email").fill(CUSTOMER.email);
    await page.locator("#customer_phone").fill(CUSTOMER.phone);
    await page.selectOption("#municipality", "Valencia City");
    await page.locator("#delivery_address").fill(CUSTOMER.address);
    const submit = page.getByRole("button", { name: "Submit order" }).first();
    await center(page, submit, 600);
    const op = owner.page;
    await op.goto("/owner/orders"); await settle(op); await op.waitForTimeout(800);
    await op.evaluate(() => window.__recCursor?.hide(true));
    const crec = new Recorder(page, "d60-submit"); const orec = new Recorder(op, "d60-arrive");
    await crec.start(); await orec.start();
    const a = actor(page, crec); const oa = actor(op, orec);
    await oa.focus(op.getByTestId("kpi-strip"), "kpis");
    await a.wait(1.2);
    const before = await op.getByTestId("kpi-to-confirm").innerText();
    const arrived = op.waitForFunction((b) => document.querySelector('[data-testid="kpi-to-confirm"]')?.textContent !== b, before, { timeout: 30_000, polling: 30 }).then(() => orec.mark("chime", { label: "arrived" }));
    await a.click(submit, { label: "submit" });
    await page.getByTestId("request-done").waitFor();
    code = (await page.getByTestId("request-code").innerText()).trim();
    crec.mark("chime", { label: "sent" });
    await center(page, page.getByTestId("request-done"), 500);
    await a.focus(page.getByTestId("request-done"), "slip");
    await arrived;
    await a.wait(3.0);
    results.push(await crec.stop()); results.push(await orec.stop());
  }

  // ------------------------------------------------ 3. owner confirms and quotes in one step
  {
    const op = owner.page;
    const rec = new Recorder(op, "d60-quote"); await rec.start(); const a = actor(op, rec);
    await a.wait(0.5);
    const d = await openDrawer(op, a, code);
    await a.focus(d.getByTestId("next-step"), "next-step");
    await a.wait(0.8);
    await a.click(d.getByTestId("next-step").getByRole("button", { name: "Confirm order" }), { label: "confirm" });
    const dlg = op.getByRole("dialog").filter({ has: op.locator("#q-price") });
    await dlg.waitFor();
    await a.focus(op.locator("#q-price"), "price");
    await a.type(op.locator("#q-price"), "18500", { delay: 110 });
    await a.wait(0.4);
    await a.click(dlg.getByRole("button", { name: "Confirm & issue quotation" }), { label: "issue" });
    await op.getByText(/^Order confirmed and quotation issued\./).first().waitFor();
    rec.mark("chime", { label: "quoted" });
    await a.wait(2.0);
    results.push(await rec.stop());
  }

  // ---------------------- off camera: the customer creates a password from the email link
  {
    const { page } = cust;
    await page.goto("/demo/inbox"); await settle(page);
    const item = page.getByTestId("inbox-item").filter({ hasText: CUSTOMER.email }).filter({ has: page.locator('a[href^="/customer/set-password"]') }).first();
    await item.waitFor({ timeout: 20_000 });
    await page.goto(await item.locator('a[href^="/customer/set-password"]').first().getAttribute("href")); await settle(page);
    await page.fill("#password", CUSTOMER.password); await page.fill("#confirm", CUSTOMER.password);
    await page.getByRole("button", { name: "Save password" }).click();
    await page.waitForURL(/\/customer\/orders/); await settle(page);
    code = code.replace(/^DR-(\d{4})$/, `JJ-${new Date().getFullYear()}-$1`);
    if (!(await page.getByTestId("customer-orders").innerText()).includes(code)) {
      code = (await page.getByTestId("customer-orders").locator("a").first().innerText()).match(/JJ-\d{4}-\d{4}|DR-\d{4}/)?.[0] ?? code;
    }
    await page.goto(`/customer/orders/${code}`); await settle(page);
  }

  // ------------------- 4. customer accepts: installment, cash · owner sees it live
  {
    const { page } = cust;
    const op = owner.page;
    await op.getByTestId("drawer-close").click().catch(() => {});
    await op.goto("/owner/orders"); await settle(op);
    const oa0 = actor(op, { mark() {} });
    await oa0.type(op.getByTestId("queue-search"), code, { delay: 0 }).catch(() => {});
    await op.locator(`[data-testid="queue-row"][data-code="${code}"], [data-testid="queue-card"][data-code="${code}"]`).filter({ visible: true }).first().click();
    const d = op.getByTestId("order-drawer"); await d.getByRole("heading", { name: code }).waitFor();
    await op.evaluate(() => window.__recCursor?.hide(true));
    const accept = page.getByTestId("accept-quotation");
    await center(page, accept, 600);
    const crec = new Recorder(page, "d60-accept"); const orec = new Recorder(op, "d60-accepted");
    await crec.start(); await orec.start();
    const a = actor(page, crec); const oa = actor(op, orec);
    await oa.focus(d.getByTestId("next-step"), "next-step");
    await a.focus(accept, "accept");
    await a.wait(0.8);
    await a.click(accept.getByText("Installment", { exact: true }), { label: "installment" });
    await a.click(accept.getByText("Cash at the shop"), { label: "cash" });
    await a.click(accept.getByText("I checked the design"), { label: "check1", ms: 450 });
    await a.click(accept.getByText("I accept the quotation"), { label: "check2", ms: 450 });
    const live = op.waitForFunction(() => /Quotation accepted/.test(document.querySelector('[data-testid="next-step"]')?.textContent ?? ""), null, { timeout: 30_000, polling: 30 }).then(() => orec.mark("chime", { label: "accepted-live" }));
    await a.click(accept.getByRole("button", { name: "Accept quotation" }), { label: "accept" });
    await page.getByText(/Quotation accepted/).first().waitFor();
    crec.mark("chime", { label: "accepted" });
    await live;
    await oa.focus(d.getByTestId("next-step"), "next-step-after");
    await a.wait(3.0);
    results.push(await crec.stop()); results.push(await orec.stop());
  }

  // -------- 5. owner manages it: approve plan, schedule, cash payment, release · customer live
  {
    const { page } = cust;
    const op = owner.page;
    await page.reload(); await settle(page);
    await page.evaluate(() => window.__recCursor?.hide(true));
    const d = op.getByTestId("order-drawer");
    const orec = new Recorder(op, "d60-manage"); const crec = new Recorder(page, "d60-live");
    await orec.start(); await crec.start();
    const a = actor(op, orec); const ca = actor(page, crec);
    await ca.focus(page.locator("main").first(), "page");
    await a.wait(0.6);
    await a.click(d.getByTestId("approve-installment").getByRole("button"), { label: "approve" });
    await op.getByText("Installment plan approved.").first().waitFor();
    orec.mark("chime", { label: "approved" });
    await a.wait(1.0);
    await a.click(d.getByRole("tab", { name: "Payments & Gate" }), { label: "tab" });
    const plan = d.getByTestId("installment-form");
    await center(op, plan, 500);
    await a.focus(d.getByTestId("installment-plan"), "plan");
    await op.locator('[name="installment_count"]').selectOption("4");
    await op.locator('[name="installment_first_due"]').fill(plusDays(manilaToday, 15));
    await a.click(plan.getByRole("button", { name: "Save plan" }), { label: "save-plan" });
    await op.getByText(/Installment plan saved/).first().waitFor();
    orec.mark("chime", { label: "plan" });
    await a.wait(1.0);
    await center(op, d.getByTestId("installment-plan"), 400);
    await a.focus(d.getByTestId("installment-plan"), "schedule");
    await a.wait(1.2);
    // first installment paid in cash at the shop
    const logBtn = d.getByRole("button", { name: "Log payment" }).first();
    await a.click(logBtn, { label: "log" });
    const pay = op.getByRole("dialog").last();
    await pay.locator("#payment_type").selectOption("Installment / Partial");
    await a.type(pay.locator("#amount"), "4625", { delay: 90 });
    await a.click(pay.getByRole("button", { name: "Save payment" }), { label: "save-payment" });
    await op.getByText("Payment recorded.").first().waitFor();
    orec.mark("chime", { label: "paid" });
    await a.wait(1.0);
    // release to the workshop
    await a.click(d.getByTestId("next-step").getByRole("button", { name: "Release to workshop" }), { label: "release" });
    await op.selectOption("#assigned_craftsman_id", { label: "Nolito Remulta" }).catch(() => {});
    await a.wait(0.6);
    const toProd = page.waitForFunction(() => /In Production/i.test(document.body.innerText), null, { timeout: 30_000, polling: 50 }).then(() => crec.mark("chime", { label: "in-production-live" }));
    await a.click(op.getByRole("dialog").last().getByRole("button", { name: "Start production" }), { label: "start" });
    await op.getByText("Released to the workshop.").first().waitFor();
    orec.mark("chime", { label: "released" });
    await toProd;
    await a.wait(2.5);
    results.push(await orec.stop()); results.push(await crec.stop());
    await op.getByTestId("drawer-close").click().catch(() => {});
  }

  // ------------------------- 6. other roles, short: craftsman → owner inspection (live)
  {
    const cr = await phone();
    await signIn(cr.page, "Craftsman");
    const op = owner.page;
    await op.goto("/owner"); await settle(op);
    const insp = op.locator("li", { hasText: "Quality inspection" }).filter({ hasText: code }).first();
    await cr.page.getByRole("tab", { name: /In Progress/ }).click();
    const job = cr.page.locator("li", { hasText: code }).first();
    await job.waitFor();
    await center(cr.page, job, 500);
    const prec = new Recorder(cr.page, "d60-craft", { scale: 2 }); await prec.start(); const pa = actor(cr.page, prec);
    await pa.focus(job, "job");
    await pa.wait(1.2);
    await pa.click(job.getByRole("button", { name: "Mark Ready for Owner Inspection" }), { label: "ready" });
    for (const box of await cr.page.getByRole("dialog").getByRole("checkbox").all()) await box.check();
    await pa.click(cr.page.getByRole("dialog").getByRole("button", { name: "Send to owner" }), { label: "send" });
    await cr.page.getByText("Moved to “Completed / For Inspection”").first().waitFor();
    prec.mark("chime", { label: "for-inspection" });
    await pa.wait(1.0);
    results.push(await prec.stop());
    await cr.ctx.close();

    await insp.waitFor({ timeout: 20_000 });
    await center(op, insp, 500);
    const orec = new Recorder(op, "d60-inspect"); await orec.start(); const oa = actor(op, orec);
    await oa.focus(insp, "inspection");
    await oa.wait(0.6);
    await oa.click(insp.getByRole("button", { name: "Pass" }), { label: "pass" });
    await oa.click(op.getByRole("button", { name: "Passed — ready for delivery" }), { label: "passed" });
    await op.getByText("Inspection passed").first().waitFor();
    orec.mark("chime", { label: "ready" });
    await oa.wait(1.2);
    results.push(await orec.stop());
  }

  // ---------------------------- off camera: the owner schedules Jesse's Multicab for today
  {
    const op = owner.page;
    await op.goto("/owner/orders"); await settle(op);
    await op.getByTestId("queue-search").fill(code);
    await op.locator(`[data-testid="queue-row"][data-code="${code}"], [data-testid="queue-card"][data-code="${code}"]`).filter({ visible: true }).first().click();
    const d = op.getByTestId("order-drawer");
    await d.getByTestId("next-step").getByRole("button", { name: "Schedule delivery" }).click();
    await op.selectOption("#driver_id", { label: "Jesse Decena" });
    await op.selectOption("#vehicle_type", "Multicab");
    await op.fill("#scheduled_date", manilaToday);
    await op.selectOption("#time_window", { index: 1 });
    await op.getByRole("dialog").getByRole("button", { name: "Schedule delivery" }).click();
    await op.getByText(/Delivery scheduled/).first().waitFor();
    await op.getByTestId("drawer-close").click().catch(() => {});
  }

  // ------------- 7. rider delivers · customer and owner see "Delivered" at the same moment
  {
    const dr = await phone();
    await signIn(dr.page, "Delivery Rider");
    await dr.page.getByText("Online • Synced").waitFor();
    const row = dr.page.locator(`[data-testid="delivery-rows"] li[data-code="${code}"]`).getByTestId("delivery-row");
    await row.waitFor({ timeout: 20_000 });
    const { page } = cust;
    await page.goto(`/customer/orders/${code}`); await settle(page);
    await page.evaluate(() => window.__recCursor?.hide(true));
    const op = owner.page;
    await op.goto("/owner/orders"); await settle(op);
    await op.evaluate(() => window.__recCursor?.hide(true));
    const rrec = new Recorder(dr.page, "d60-rider", { scale: 2 }); const crec = new Recorder(page, "d60-done-cust"); const orec = new Recorder(op, "d60-done-owner");
    await rrec.start(); await crec.start(); await orec.start();
    const ra = actor(dr.page, rrec);
    await ra.click(row, { label: "open" });
    const detail = dr.page.getByTestId("delivery-detail");
    await ra.click(detail.getByRole("button", { name: "Start Trip" }), { label: "start-trip" });
    await ra.wait(1.4);
    rrec.mark("chime", { label: "out" });
    await ra.click(detail.getByRole("button", { name: "Mark Delivered & Log Cash Collected" }), { label: "delivered" });
    await ra.wait(0.5);
    const custLive = page.waitForFunction(() => /Delivered/.test(document.body.innerText), null, { timeout: 30_000, polling: 50 }).then(() => crec.mark("chime", { label: "delivered-live" }));
    await ra.click(dr.page.getByRole("button", { name: "Save delivery" }), { label: "save" });
    await dr.page.getByText(/Synced \d+ action/).first().waitFor({ timeout: 20_000 }).catch(() => {});
    rrec.mark("chime", { label: "delivered" });
    await custLive;
    orec.mark("chime", { label: "delivered-owner" });
    await ra.wait(3.0);
    results.push(await rrec.stop()); results.push(await crec.stop()); results.push(await orec.stop());
    await dr.ctx.close();
  }
} finally {
  console.log(JSON.stringify(results.map((r) => ({ name: r.name, duration: r.duration, frames: r.frames, events: r.events.length })), null, 1));
  console.log("order:", code);
  await Promise.all(browsers.map((b) => b.close()));
}
