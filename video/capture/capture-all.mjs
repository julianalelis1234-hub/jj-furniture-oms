// Records every scene of the pitch video from the REAL app (Demo Mode, curated 5-order dataset).
//
//   1. start the app on a fresh in-memory demo:   PORT=3100 npm start      (no DEMO_DATASET)
//   2. node video/capture/capture-all.mjs          (BASE_URL defaults to http://localhost:3100)
//
// Output: video/public/clips/<scene>.mp4 (60 fps H.264) + <scene>.json (events on the clip clock:
// clicks with coordinates, "focus" boxes the editor zooms into). Raw frames go to capture/raw (git-ignored).
// The caramel cursor ring and click ripples are a recording overlay injected by this script only.
import { chromium, Recorder, actor, CURSOR_SCRIPT } from "./recorder.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const ONLY = process.env.ONLY?.split(",");
const ZOOM = 4 / 3; // 1920x1080 viewport laid out like 1440x810, rendered at full 1080p
const CUSTOMER = { name: "Andrea Villanueva", email: "andrea.villanueva@example.com", phone: "0900 000 0210", address: "Purok 5, Brgy. Lumbo, near the barangay hall", password: "Narra-Sunrise-2026" };
const manilaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"] });
async function desktop() {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, baseURL: BASE, reducedMotion: "no-preference" });
  await ctx.addInitScript((z) => {
    localStorage.setItem("theme", "dark");
    const apply = () => { document.documentElement.style.zoom = String(z); };
    apply(); document.addEventListener("DOMContentLoaded", apply);
  }, ZOOM);
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, baseURL: BASE, reducedMotion: "no-preference" });
  await ctx.addInitScript(() => localStorage.setItem("theme", "dark"));
  await ctx.addInitScript(CURSOR_SCRIPT);
  await ctx.addInitScript(() => sessionStorage.setItem("rec-cursor-hidden", "1")); // phones show touch ripples only
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}
const enterAs = async (page, who) => {
  await page.goto("/");
  await page.getByRole("button", { name: `Enter as ${who}` }).click();
  await page.waitForLoadState("networkidle");
};
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});
const want = (name) => !ONLY || ONLY.includes(name);
const smoothScroll = (page, y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y);
async function scrollIntoCenter(page, loc) {
  const top = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); return window.scrollY + r.top + r.height / 2 - window.innerHeight / 2; });
  await smoothScroll(page, Math.max(0, top)); await page.waitForTimeout(900);
}
async function openDrawer(page, a, code) {
  await a.type(page.getByTestId("queue-search"), code, { delay: 45 });
  await a.click(page.locator(`[data-testid="queue-row"][data-code="${code}"]`), { label: "row" });
  const d = page.getByTestId("order-drawer");
  await d.getByRole("heading", { name: code }).waitFor();
  return d;
}

let code = ""; // DR-xxxx, then JJ-YYYY-xxxx once accepted
const results = [];
try {
  // ------------------------------------------------------------------ S1 home
  if (want("s1-home")) {
    const { ctx, page } = await desktop();
    await page.goto("/"); await settle(page); await page.waitForTimeout(1200);
    await page.evaluate(() => window.__recCursor?.hide(true));
    const rec = new Recorder(page, "s1-home"); await rec.start();
    await page.waitForTimeout(16_000);
    results.push(await rec.stop());
    await ctx.close();
  }

  // ---------------------------------------- S3 customer + S4 staff (concurrent)
  const cust = await desktop();
  const staff = await desktop();
  await enterAs(staff.page, "Gilbert Decena");
  {
    const { page } = cust;
    await page.goto("/customer/customize"); await settle(page); await page.waitForTimeout(1500);
    const preview = page.locator("canvas").first();
    await scrollIntoCenter(page, page.getByText("1 · Design your furniture"));
    const rec = new Recorder(page, "s3-customer"); await rec.start(); const a = actor(page, rec);
    await a.wait(2.0);
    await a.focus(preview, "preview");
    // drag-rotate the 3D model (cursor follows the pointer)
    const b = await preview.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height * 0.55;
    await page.evaluate(([x, y]) => window.__recCursor.move(x, y, 900), [cx - 90, cy]); await a.wait(0.3);
    rec.mark("drag", { x: cx - 90, y: cy });
    // two smooth drags; few, larger steps keep the slow software-GL page responsive
    const drag = async (x0, dx, steps, wob) => {
      await page.mouse.move(x0, cy); await page.mouse.down();
      for (let i = 1; i <= steps; i++) {
        const x = x0 + dx * (i / steps), y = cy + Math.sin(i / 3) * wob;
        await Promise.all([page.mouse.move(x, y), page.evaluate(([x, y]) => window.__recCursor.move(x, y, 60), [x, y])]);
      }
      await page.mouse.up();
    };
    await drag(cx - 90, 220, 14, 8); await a.wait(0.5);
    await drag(cx + 120, -260, 14, -6); await a.wait(0.4);
    // hover near the 165 cm figure (left side of the preview)
    await page.evaluate(([x, y]) => window.__recCursor.move(x, y, 900), [b.x + b.width * 0.26, b.y + b.height * 0.45]);
    rec.mark("figure", { x: b.x + b.width * 0.26, y: b.y + b.height * 0.45 });
    await a.wait(2.2);
    // dimensions + wood + finish
    await a.focus(page.getByText("Size (W × H × D)").first(), "dims");
    await a.click(page.getByTestId("cat-Dining Table"));
    await a.click(page.getByRole("radio", { name: "6-Seater Classic" }), { force: true });
    await a.type(page.getByLabel("Width (cm)"), "200", { delay: 140 });
    await a.type(page.getByLabel("Depth (cm)"), "95", { delay: 140 });
    await a.click(page.getByTestId("wood-Mahogany"));
    await scrollIntoCenter(page, page.getByTestId("finish-Walnut Stain"));
    await a.click(page.getByTestId("finish-Walnut Stain"), { label: "finish" });
    await a.wait(1.0);
    // contact details (brisk), then send
    await scrollIntoCenter(page, page.locator("#customer_name"));
    await a.type(page.locator("#customer_name"), CUSTOMER.name, { delay: 22 });
    // the rest is filled briskly (the cursor still visits each field)
    for (const [sel, val] of [["#customer_email", CUSTOMER.email], ["#customer_phone", CUSTOMER.phone], ["#delivery_address", CUSTOMER.address]]) {
      await a.moveTo(page.locator(sel), 380); await page.locator(sel).fill(val);
    }
    await page.selectOption("#municipality", "Valencia City");
    const send = page.getByRole("button", { name: "Send request for quotation" });
    await scrollIntoCenter(page, send);
    // staff screen starts recording a few seconds before the request lands
    const srec = new Recorder(staff.page, "s4-staff"); await srec.start(); const sa = actor(staff.page, srec);
    await sa.focus(staff.page.getByTestId("kpi-strip"), "kpis");
    await a.wait(4.5);
    const before = await staff.page.locator('[data-testid="queue-row"]').count();
    const arrived = staff.page.waitForFunction((n) => document.querySelectorAll('[data-testid="queue-row"]').length > n, before, { timeout: 30_000, polling: 50 }).then(() => srec.mark("arrived"));
    await a.click(send, { label: "submit" });
    await page.getByTestId("request-done").waitFor();
    code = (await page.getByTestId("request-code").innerText()).trim();
    await scrollIntoCenter(page, page.getByTestId("request-done"));
    rec.mark("chime", { label: "request-sent" });
    await a.focus(page.getByTestId("request-done"), "done");
    await a.wait(4.0);
    results.push(await rec.stop());

    // ------------------------------------------------------------- S4 staff
    const sp = staff.page;
    const row = sp.locator(`[data-testid="queue-row"][data-code="${code}"]`);
    await row.waitFor({ timeout: 20_000 });
    await arrived;
    await sa.focus(row, "newrow");
    await sa.wait(5.5);
    await sa.click(row, { label: "row" });
    const d = sp.getByTestId("order-drawer");
    await d.getByRole("heading", { name: code }).waitFor();
    srec.mark("drawer"); await sa.wait(3.0);
    await sa.click(d.getByRole("tab", { name: "Quotation & Revisions" }));
    await sa.wait(2.0);
    await sa.click(d.getByTestId("next-step").getByRole("button", { name: "Issue quotation" }));
    const dlg = sp.getByRole("dialog").last();
    await sa.focus(dlg, "quote-dialog");
    await sa.type(sp.locator("#q-price"), "38500", { delay: 120 });
    await sa.type(sp.locator("#q-slip"), "0210", { delay: 110 });
    await sa.wait(0.6);
    await sa.click(sp.getByRole("button", { name: "Send quotation" }), { label: "send" });
    await sp.getByText("Quotation saved as a new revision.").first().waitFor();
    srec.mark("chime", { label: "quote-sent" });
    await sa.wait(1.0);
    await sa.focus(d.getByText("Notifications").first().or(d.getByTestId("next-step")), "outbox").catch(() => {});
    await sa.wait(3.5);
    results.push(await srec.stop());
  }

  // ---------------------------------------- S5 customer accepts + sets password
  {
    const { page } = cust;
    await page.goto("/demo/inbox"); await settle(page); await page.waitForTimeout(800);
    const rec = new Recorder(page, "s5-accept"); await rec.start(); const a = actor(page, rec);
    const mail = page.getByTestId("inbox-item").filter({ hasText: CUSTOMER.email }).first();
    await a.focus(mail, "quote-email");
    await a.wait(2.5);
    await a.click(mail.locator('a[href^="/customer/review"]').first(), { label: "review-link" });
    await page.getByRole("button", { name: "Open my quotation" }).waitFor(); await a.wait(1.2);
    await a.click(page.getByRole("button", { name: "Open my quotation" }));
    await page.waitForURL(/\/customer\/review\/quote/); await settle(page); await a.wait(1.5);
    const accept = page.getByRole("button", { name: "Accept Quote & Confirm Specifications" });
    await scrollIntoCenter(page, accept);
    await a.click(accept);
    await a.wait(0.8);
    await a.click(page.getByTestId("accept-specification"));
    await a.click(page.getByTestId("accept-quotation"));
    await a.click(page.getByRole("dialog").getByRole("button", { name: "Accept quote & confirm" }), { label: "accept" });
    await page.getByTestId("setup-email-sent").waitFor();
    rec.mark("chime", { label: "accepted" });
    await a.focus(page.getByTestId("review-accepted"), "accepted");
    await a.wait(2.5);
    // the confirmation email with the create-password link
    await page.goto("/demo/inbox"); await settle(page);
    rec.mark("flip");
    const setup = page.getByTestId("inbox-item").filter({ hasText: CUSTOMER.email }).filter({ has: page.locator('a[href^="/customer/set-password"]') }).first();
    await scrollIntoCenter(page, setup);
    await a.focus(setup, "setup-email");
    await a.wait(2.0);
    await a.click(setup.locator('a[href^="/customer/set-password"]').first(), { label: "setup-link" });
    await page.waitForURL(/\/customer\/set-password/); await settle(page); await a.wait(1.0);
    await a.focus(page.locator("form").first(), "password-form");
    await a.type(page.locator("#password"), CUSTOMER.password, { delay: 95 });
    await a.type(page.locator("#confirm"), CUSTOMER.password, { delay: 45 });
    await a.wait(0.8);
    await a.click(page.getByRole("button", { name: "Save password" }), { label: "save" });
    await page.waitForURL(/\/customer\/orders/); await settle(page);
    rec.mark("chime", { label: "confirmed" });
    code = code.replace(/^DR-(\d{4})$/, `JJ-${new Date().getFullYear()}-$1`);
    await a.focus(page.getByTestId("customer-orders"), "orders");
    await a.wait(4.0);
    results.push(await rec.stop());
  }

  // --------------------------------- S6 staff logs 30% · owner releases to workshop
  const owner = await desktop();
  await enterAs(owner.page, "Mr. Vincris Lelis");
  {
    const page = staff.page;
    await page.getByTestId("drawer-close").click().catch(() => {});
    await page.goto("/staff"); await settle(page);
    const rec = new Recorder(page, "s6-gate"); await rec.start(); const a = actor(page, rec);
    await a.wait(0.8);
    const d = await openDrawer(page, a, code);
    await a.click(d.getByRole("tab", { name: "Payments & Gate" }));
    await a.focus(d.getByTestId("production-gate"), "gate-before");
    await a.wait(2.0);
    await a.click(d.getByTestId("next-step").getByRole("button", { name: "Log payment" }));
    await a.wait(1.2);
    await a.focus(page.getByRole("dialog").last(), "payment-dialog");
    await a.wait(1.5);
    await a.click(page.getByRole("button", { name: "Save payment" }), { label: "save-payment" });
    await page.getByText("Payment recorded.").first().waitFor();
    await a.wait(0.6);
    await scrollIntoCenter(page, d.getByTestId("production-gate")).catch(() => {});
    rec.mark("chime", { label: "gate-met" });
    await a.focus(d.getByTestId("production-gate"), "gate-after");
    await a.wait(5.0);
    results.push(await rec.stop());

    const op = owner.page;
    await op.goto("/owner"); await settle(op);
    const orec = new Recorder(op, "s6-owner"); await orec.start(); const oa = actor(op, orec);
    await oa.wait(0.8);
    const od = await openDrawer(op, oa, code);
    await oa.wait(1.0);
    await oa.click(od.getByTestId("next-step").getByRole("button", { name: "Release to workshop" }));
    await op.selectOption("#assigned_craftsman_id", { label: "Nolito Remulta" }).catch(() => {});
    await oa.wait(1.2);
    await oa.click(op.getByRole("dialog").last().getByRole("button", { name: "Start production" }), { label: "release" });
    await op.getByText("Released to the workshop.").first().waitFor();
    orec.mark("chime", { label: "in-production" });
    await oa.focus(od.getByRole("heading", { name: code }), "stage");
    await oa.wait(4.0);
    results.push(await orec.stop());
    await op.getByTestId("drawer-close").click().catch(() => {});
  }

  // ----------------------- S7 craftsman phone + owner desktop (live), recorded together
  {
    const cr = await phone();
    await enterAs(cr.page, "Nolito Remulta");
    const op = owner.page;
    await op.goto("/owner"); await settle(op);
    await scrollIntoCenter(op, op.getByRole("heading", { name: "Awaiting your decision" }));
    const prec = new Recorder(cr.page, "s7-craftsman", { scale: 2 }); await prec.start(); const pa = actor(cr.page, prec);
    const orec = new Recorder(op, "s7-owner"); await orec.start(); const oa = actor(op, orec);
    await pa.wait(1.2);
    await pa.click(cr.page.getByRole("tab", { name: /In Progress/ }));
    const job = cr.page.locator("li", { hasText: code }).first();
    await scrollIntoCenter(cr.page, job);
    await pa.focus(job, "job");
    await pa.wait(2.0);
    await pa.click(job.getByRole("button", { name: "Mark Ready for Owner Inspection" }));
    await pa.wait(0.6);
    for (const box of await cr.page.getByRole("dialog").getByRole("checkbox").all()) { await pa.click(box); }
    await pa.click(cr.page.getByRole("button", { name: "Send to owner" }), { label: "send-owner" });
    await cr.page.getByText("Moved to “Completed / For Inspection”").first().waitFor();
    prec.mark("chime", { label: "for-inspection" });
    // owner sees the inspection arrive live, passes it
    const insp = op.locator("li", { hasText: "Quality inspection" }).filter({ hasText: code }).first();
    await insp.waitFor({ timeout: 20_000 });
    orec.mark("chime", { label: "inspection-arrived" });
    await oa.focus(insp, "inspection");
    await oa.wait(2.5);
    await oa.click(insp.getByRole("button", { name: "Pass" }));
    await oa.click(op.getByRole("button", { name: "Passed — ready for delivery" }), { label: "pass" });
    await op.getByText("Inspection passed").first().waitFor();
    orec.mark("chime", { label: "ready-for-delivery" });
    await pa.wait(3.0);
    results.push(await prec.stop());
    results.push(await orec.stop());
    await cr.ctx.close();
  }

  // ---------------------------- off camera: staff schedules Jesse's Multicab for today
  {
    const page = staff.page;
    await page.goto("/staff"); await settle(page);
    await page.getByTestId("queue-search").fill(code);
    await page.locator(`[data-testid="queue-row"][data-code="${code}"]`).click();
    const d = page.getByTestId("order-drawer");
    await d.getByTestId("next-step").getByRole("button", { name: "Schedule delivery" }).click();
    await page.selectOption("#driver_id", { label: "Jesse Decena" });
    await page.selectOption("#vehicle_type", "Multicab");
    await page.fill("#scheduled_date", manilaToday);
    await page.selectOption("#time_window", "1:00 PM - 3:00 PM");
    await page.getByRole("dialog").getByRole("button", { name: "Schedule delivery" }).click();
    await page.getByText("Delivery scheduled").first().waitFor();
  }

  // ---------------------------------------------- S8 driver phone, then customer
  {
    const dr = await phone();
    await enterAs(dr.page, "Jesse Decena");
    await dr.page.getByText("Online • Synced").waitFor();
    const trip = dr.page.locator("li", { hasText: code }).first();
    await scrollIntoCenter(dr.page, trip);
    const rec = new Recorder(dr.page, "s8-driver", { scale: 2 }); await rec.start(); const a = actor(dr.page, rec);
    await a.focus(trip, "trip");
    await a.wait(1.5);
    await a.click(trip.getByRole("button", { name: "Start Trip" }), { label: "start-trip" });
    await a.wait(1.6);
    rec.mark("chime", { label: "out-for-delivery" });
    await scrollIntoCenter(dr.page, trip);
    await a.click(trip.getByRole("button", { name: "Mark Delivered & Log Cash Collected" }));
    await a.wait(1.0);
    await a.click(dr.page.getByRole("button", { name: "Save delivery" }), { label: "delivered" });
    await dr.page.getByText(/Synced \d+ action/).first().waitFor({ timeout: 20_000 }).catch(() => {});
    rec.mark("chime", { label: "delivered" });
    await a.wait(1.2);
    await a.click(dr.page.getByRole("tab", { name: /Done/ }));
    const doneCard = dr.page.locator("li", { hasText: code }).first();
    await doneCard.waitFor();
    await a.focus(doneCard, "done-card");
    await a.wait(2.5);
    results.push(await rec.stop());
    await dr.ctx.close();

    const page = cust.page;
    await page.goto("/customer/orders"); await settle(page); await page.waitForTimeout(800);
    const crec = new Recorder(page, "s8-customer"); await crec.start(); const ca = actor(page, crec);
    await page.evaluate(() => window.__recCursor?.hide(true));
    const card = page.getByTestId("customer-orders");
    await ca.focus(card, "delivered");
    await ca.wait(9.0);
    results.push(await crec.stop());
  }
} finally {
  console.log(JSON.stringify(results.map((r) => ({ name: r.name, duration: r.duration, frames: r.frames, events: r.events.length })), null, 1));
  console.log("order:", code);
  await browser.close();
}
