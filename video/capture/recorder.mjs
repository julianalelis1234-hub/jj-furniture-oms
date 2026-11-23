// Screencast recorder: high-quality JPEG frames from Chrome DevTools, stamped with wall-clock
// time, plus an event log (cursor moves, clicks, zoom targets) on the same clock.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
export { chromium };

export const RAW = path.resolve(import.meta.dirname, "raw");
export const OUT = path.resolve(import.meta.dirname, "../public/clips");

/** Smooth in-page cursor (Caramel ring) + click ripple. Purely a recording overlay; not part of the app. */
export const CURSOR_SCRIPT = () => {
  const install = () => {
    if (document.getElementById("rec-cursor") || !document.body) return;
    const c = document.createElement("div");
    c.id = "rec-cursor";
    c.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;" +
      "border:3px solid #C48A5A;background:rgba(196,138,90,.22);box-shadow:0 0 0 2px rgba(43,29,23,.55),0 4px 14px rgba(0,0,0,.45);transition:none;left:-60px;top:-60px";
    const dot = document.createElement("div");
    dot.style.cssText = "position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#FAF6F0";
    c.appendChild(dot);
    c.style.zoom = String(1 / (parseFloat(document.documentElement.style.zoom || "1") || 1));
    document.body.appendChild(c);
    const p = JSON.parse(sessionStorage.getItem("rec-cursor") || "null");
    if (p) { c.style.left = p.x + "px"; c.style.top = p.y + "px"; }
    if (sessionStorage.getItem("rec-cursor-hidden") === "1") c.style.opacity = "0";
  };
  window.__recCursor = {
    move(x, y, ms) {
      install();
      const c = document.getElementById("rec-cursor");
      const x0 = parseFloat(c.style.left), y0 = parseFloat(c.style.top);
      const sx = isFinite(x0) && x0 > -50 ? x0 : x + 120, sy = isFinite(y0) && y0 > -50 ? y0 : y + 80;
      const ease = (t) => 1 - Math.pow(1 - t, 3) * (1 - t * 0.0); // ease-out cubic-ish (bezier .22,1,.36,1 approx)
      const t0 = performance.now();
      return new Promise((res) => {
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms), e = ease(t);
          // gentle arc so motion is never a robotic straight line
          const arc = Math.sin(Math.PI * t) * Math.min(40, Math.hypot(x - sx, y - sy) * 0.08);
          c.style.left = sx + (x - sx) * e + "px"; c.style.top = sy + (y - sy) * e - arc + "px";
          sessionStorage.setItem("rec-cursor", JSON.stringify({ x: sx + (x - sx) * e, y: sy + (y - sy) * e }));
          if (t < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    },
    ripple(x, y) {
      const r = document.createElement("div");
      r.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;left:${x}px;top:${y}px;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid #C48A5A;background:rgba(196,138,90,.35)`;
      r.style.zoom = String(1 / (parseFloat(document.documentElement.style.zoom || "1") || 1));
      document.body.appendChild(r);
      r.animate([{ transform: "scale(0)", opacity: 0.6 }, { transform: "scale(2.2)", opacity: 0 }], { duration: 650, easing: "cubic-bezier(.22,1,.36,1)" }).onfinish = () => r.remove();
      const c = document.getElementById("rec-cursor");
      c?.animate([{ transform: "scale(1)" }, { transform: "scale(.78)" }, { transform: "scale(1)" }], { duration: 260 });
    },
    hide(h) { sessionStorage.setItem("rec-cursor-hidden", h ? "1" : "0"); const c = document.getElementById("rec-cursor"); if (c) c.style.opacity = h ? "0" : "1"; },
  };
  document.addEventListener("DOMContentLoaded", install);
  setTimeout(install, 30);
};

export class Recorder {
  constructor(page, name, opts = {}) { this.page = page; this.name = name; this.frames = []; this.events = []; this.dir = path.join(RAW, name); this.scale = opts.scale ?? 1; }
  async start() {
    rmSync(this.dir, { recursive: true, force: true }); mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    if (this.scale !== 1) return this.startShots();
    const vp = this.page.viewportSize(); const dpr = await this.page.evaluate(() => devicePixelRatio);
    this.cdp.on("Page.screencastFrame", async (f) => {
      const file = path.join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      this.frames.push({ file, t: f.metadata.timestamp });
      try { await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, everyNthFrame: 1 });
    this.t0 = Date.now() / 1000;
    // keep frames flowing even on a static page (screencast only emits on paint)
    this.ticker = setInterval(() => this.page.evaluate(() => { const d = document.getElementById("rec-tick") ?? Object.assign(document.documentElement.appendChild(document.createElement("div")), { id: "rec-tick" }); d.style.cssText = `position:fixed;left:0;top:0;width:1px;height:1px;opacity:${Math.random() * 0.01};pointer-events:none`; }).catch(() => {}), 33);
  }
  /** phones: a tight captureScreenshot loop at device pixels (screencast only gives CSS pixels) */
  async startShots() {
    const vp = this.page.viewportSize();
    this.t0 = Date.now() / 1000; this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          const t = Date.now() / 1000;
          // clip coordinates are document coordinates: follow the current scroll position
          const { result } = await this.cdp.send("Runtime.evaluate", { expression: "[scrollX, scrollY]", returnByValue: true });
          const [sx, sy] = result.value ?? [0, 0];
          const r = await this.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, clip: { x: sx, y: sy, width: vp.width, height: vp.height, scale: this.scale } });
          const file = path.join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
          writeFileSync(file, Buffer.from(r.data, "base64"));
          this.frames.push({ file, t: (t + Date.now() / 1000) / 2 });
        } catch { await new Promise((r) => setTimeout(r, 20)); }
      }
    })();
  }
  /** seconds since recording start */
  now() { return Date.now() / 1000 - this.t0; }
  mark(type, data = {}) { this.events.push({ t: +this.now().toFixed(3), type, ...data }); }
  async stop(holdSeconds = 0) {
    if (holdSeconds) await this.page.waitForTimeout(holdSeconds * 1000);
    clearInterval(this.ticker);
    this.running = false; await this.loop;
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    const end = Date.now() / 1000;
    // concat demuxer with real durations -> constant 60 fps H.264 (frames are repeated, never invented)
    const lines = [];
    const fr = this.frames.filter((f) => f.t >= this.t0 - 0.05);
    fr.forEach((f, i) => { const next = i + 1 < fr.length ? fr[i + 1].t : end; lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`); });
    lines.push(`file '${fr.at(-1).file}'`);
    const list = path.join(this.dir, "list.txt"); writeFileSync(list, lines.join("\n"));
    mkdirSync(OUT, { recursive: true });
    const first = fr[0].t - this.t0; // usually ~0; events are shifted onto the clip clock
    const vp = this.page.viewportSize();
    const even = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `${even},fps=60`, "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(OUT, `${this.name}.mp4`)]);
    const meta = { name: this.name, scale: this.scale, duration: +(end - fr[0].t).toFixed(3), viewport: vp, frames: fr.length, events: this.events.map((e) => ({ ...e, t: +(e.t - first).toFixed(3) })) };
    writeFileSync(path.join(OUT, `${this.name}.json`), JSON.stringify(meta, null, 2));
    return meta;
  }
}

/** Helpers that move the visible cursor before acting, and log events for the editor. */
export function actor(page, rec) {
  const center = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const api = {
    wait: (s) => page.waitForTimeout(s * 1000),
    async moveTo(loc, ms = 750) { const { x, y } = await center(loc); await page.evaluate(([x, y, ms]) => window.__recCursor?.move(x, y, ms), [x, y, ms]); return { x, y }; },
    async click(loc, opts = {}) {
      const { x, y } = await api.moveTo(loc, opts.ms ?? 750);
      await api.wait(0.12);
      rec.mark("click", { x, y, label: opts.label });
      await page.evaluate(([x, y]) => window.__recCursor?.ripple(x, y), [x, y]);
      await loc.click({ force: opts.force });
      await api.wait(opts.after ?? 0.35);
    },
    async type(loc, text, opts = {}) {
      await api.click(loc, opts);
      await loc.fill("");
      await loc.pressSequentially(text, { delay: opts.delay ?? 75 });
    },
    /** element box (CSS px) for an editor zoom; also logs the event */
    async focus(loc, label, extra = {}) { await loc.scrollIntoViewIfNeeded().catch(() => {}); const b = await loc.boundingBox(); rec.mark("focus", { label, box: b, ...extra }); return b; },
    mark: (type, data) => rec.mark(type, data),
  };
  return api;
}
