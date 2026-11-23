// Renders the artwork pages to print PNG + PDF (static server so fonts/images/modules load).
//   node marketing/render.mjs [poster backdrop rollup counter booth3d plan sheet]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(import.meta.dirname, "out");
const JOBS = {
  poster: { w: 1200, h: 1800, scale: 3, pdf: { width: "24in", height: "36in" }, file: "jj-poster-24x36" },
  backdrop: { w: 1500, h: 1200, scale: 4, pdf: { width: "3000mm", height: "2400mm" }, file: "booth-backdrop-3000x2400mm" },
  rollup: { w: 850, h: 2000, scale: 3, pdf: { width: "850mm", height: "2000mm" }, file: "booth-rollup-850x2000mm" },
  counter: { w: 1000, h: 500, scale: 3, file: "booth-counter-wrap-2000x1000mm" },
  booth3d: { w: 1600, h: 1000, scale: 1.5, file: "booth-render", wait: "window.__ready === true", gl: true },
  plan: { w: 1600, h: 1100, scale: 2, pdf: { width: "420mm", height: "289mm" }, file: "booth-floor-plan" },
  sheet: { w: 1600, h: 1100, scale: 2, pdf: { width: "420mm", height: "289mm" }, file: "booth-station-guide" },
};
const only = process.argv.slice(2);
const server = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const [name, j] of Object.entries(JOBS)) {
    if (only.length && !only.includes(name)) continue;
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: j.scale });
    page.on("pageerror", (e) => console.error(name, e.message));
    await page.goto(`http://127.0.0.1:8765/marketing/pages/${name}.html`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    if (j.wait) await page.waitForFunction(j.wait, null, { timeout: 180_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${j.file}.png` });
    if (j.pdf) await page.pdf({ path: `${OUT}/${j.file}.pdf`, width: j.pdf.width, height: j.pdf.height, printBackground: true, pageRanges: "1", scale: 1 });
    console.log("rendered", j.file);
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
