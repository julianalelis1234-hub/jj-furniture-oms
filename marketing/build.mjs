// Generates the print artwork as self-contained HTML pages (rendered by render.mjs).
//   node marketing/build.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, fontsCss, icon, PORTALS, stageTracker, tree } from "./lib.mjs";

const DIR = path.resolve(import.meta.dirname, "pages");
mkdirSync(DIR, { recursive: true });
const shot = (n) => `../shots/${n}.png`;

/* ------------------------------------------------------------------ helpers */
const laptop = (img, w) => `
<div style="width:${w}px">
  <div style="border-radius:${w * 0.022}px ${w * 0.022}px 0 0;background:#120c09;padding:${w * 0.018}px;border:2px solid #4a3329;box-shadow:0 30px 80px -20px rgba(0,0,0,.8),0 0 60px rgba(196,138,90,.15)">
    <img src="${img}" style="display:block;width:100%;border-radius:4px"/>
  </div>
  <div style="height:${w * 0.03}px;margin:0 -${w * 0.06}px;border-radius:0 0 ${w * 0.04}px ${w * 0.04}px;background:linear-gradient(#5a4134,#2b1d17)"></div>
</div>`;
const phone = (img, w, crop = 0.82) => `
<div style="width:${w}px;padding:${w * 0.045}px;border-radius:${w * 0.16}px;background:linear-gradient(160deg,#3b2a22,#1a110d);box-shadow:0 0 0 2px #5a4134,0 0 40px rgba(196,138,90,.22),0 30px 70px -18px rgba(0,0,0,.85)">
  <div style="border-radius:${w * 0.12}px;overflow:hidden;height:${(w * 0.91 * 2532) / 1170 * crop}px;background:${C.espresso}"><img src="${img}" style="display:block;width:100%"/></div>
</div>`;

/* ================================================================== POSTER */
// 24 x 36 in portrait. 1200 x 1800 CSS px => 3600 x 5400 px at 3x (150 dpi).
const features = [
  ["Box", "Live 3D configurator", "Type, design, size, wood and finish update a real-time 3D model beside a 165 cm human figure, so customers see true scale."],
  ["MailCheck", "Quote by email, accept online", "Official quotations arrive with a single-use review link. Customers confirm the spec AND the price, then create their own password."],
  ["ShieldCheck", "30% production gate", "No wood is cut until a 30% down payment is verified. Unverified submissions never count; the delivery fee stays separate."],
  ["RadioTower", "Real-time live sync", "One shared order record: a craftsman's tap updates the owner's dashboard and the customer's tracker instantly."],
  ["WifiOff", "Offline-first driver app", "Assignments are saved on the phone. Delivered + cash collected is stored locally and syncs automatically with an honest status."],
  ["LockKeyhole", "Secure by design", "Role-based access with Supabase Row-Level Security, atomic single-use links, encrypted email tokens, no plaintext passwords."],
];
const tech = ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4", "Supabase · Postgres", "Row-Level Security", "Realtime", "three.js", "Resend / Gmail SMTP", "Playwright", "Vitest"];

const poster = `<!doctype html><html><head><meta charset="utf-8"><title>JJ Furniture — Poster</title><style>${fontsCss()}
html,body{width:1200px;height:1800px;overflow:hidden}
.page{position:relative;display:flex;flex-direction:column;width:1200px;height:1800px;padding:50px 60px 44px;background:
 radial-gradient(900px 520px at 50% 26%, rgba(196,138,90,.20), transparent 70%),
 radial-gradient(700px 500px at 85% 95%, rgba(107,74,58,.35), transparent 70%), ${C.espresso}}
.card{background:rgba(54,37,30,.85);border:1px solid ${C.border};border-radius:22px}
h2{font-family:"EB Garamond",serif;font-weight:600;color:${C.cream};font-size:28px;line-height:1.1}
ul{font-size:16px!important;line-height:1.5!important}
</style></head><body><div class="page" id="poster">
  <!-- header -->
  <div style="display:flex;align-items:center;gap:30px">
    ${tree(104)}
    <div style="flex:1">
      <div class="eyebrow" style="font-size:14px">Capstone Project · JJ Furniture Shop and Enterprises · Valencia City</div>
      <div class="serif" style="font-size:66px;line-height:1.02;color:${C.cream};margin-top:8px;font-weight:500;white-space:nowrap">JJ Furniture Management System</div>
      <div style="font-size:20px;color:${C.latte};margin-top:10px;line-height:1.4">One shared, live order record for a custom furniture workshop: from a customer's 3D design to the delivered piece, across five role-based portals.</div>
    </div>
  </div>
  <div style="height:1px;background:linear-gradient(90deg,transparent,${C.caramel},transparent);margin:24px 0 22px"></div>

  <!-- problem / solution -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
    <div class="card" style="padding:20px 26px">
      <div class="eyebrow" style="font-size:13px">The problem</div>
      <h2 style="margin:8px 0 12px">Orders lived on paper and phone calls</h2>
      <ul style="font-size:18px;line-height:1.55;padding-left:22px">
        <li>Handwritten slips at the counter, easy to misplace</li>
        <li>Workshop priorities passed on verbally</li>
        <li>Customers calling again and again for status</li>
        <li>Deliveries and collected cash hard to reconcile</li>
      </ul>
    </div>
    <div class="card" style="padding:20px 26px;border-color:${C.caramel};box-shadow:0 0 40px rgba(196,138,90,.18)">
      <div class="eyebrow" style="font-size:13px">Our solution</div>
      <h2 style="margin:8px 0 12px">One live record · five portals · seven stages</h2>
      <ul style="font-size:18px;line-height:1.55;padding-left:22px">
        <li>Every role sees the same order, updated in real time</li>
        <li>Customers design and track orders themselves</li>
        <li>Production starts only after a verified 30% deposit</li>
        <li>Works in any phone browser: nothing to install</li>
      </ul>
    </div>
  </div>

  <!-- hero visual -->
  <div style="position:relative;height:500px;margin-top:26px">
    <div style="position:absolute;left:0;top:30px">${laptop(shot("staff-queue"), 690)}</div>
    <div style="position:absolute;left:24px;top:-6px" class="eyebrow"><span style="font-size:13px">Staff S-01 · Operations & Order Queue</span></div>
    <div style="position:absolute;right:250px;top:34px">${phone(shot("craftsman-phone"), 178, 0.78)}</div>
    <div style="position:absolute;right:30px;top:0px">${phone(shot("customer-phone"), 196, 0.56)}</div>
    <div style="position:absolute;right:0;top:268px;width:300px;border-radius:20px;overflow:hidden;border:1.5px solid ${C.caramel};box-shadow:0 0 40px rgba(196,138,90,.35)">
      <img src="${shot("model3d")}" style="display:block;width:100%"/>
      <div style="position:absolute;left:14px;bottom:10px;font-size:13px;font-weight:800;letter-spacing:.2em;color:${C.cream};text-transform:uppercase">Live 3D preview</div>
    </div>
  </div>

  <!-- 7 stages -->
  <div class="card" style="padding:18px 26px 16px;margin-top:10px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px">
      <h2 style="font-size:26px">The 7-stage order lifecycle</h2>
      <div style="font-size:16px">Quote requests stay at <b style="color:${C.cream}">intake</b> until accepted</div>
    </div>
    ${stageTracker(36, 13)}
  </div>

  <!-- portals -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:16px">
    ${PORTALS.map((p) => `<div class="card" style="padding:14px 12px;text-align:center">
      <div style="width:52px;height:52px;margin:0 auto 8px;border-radius:99px;border:1.5px solid ${C.caramel};display:flex;align-items:center;justify-content:center;box-shadow:0 0 22px rgba(196,138,90,.3)">${icon(p.icon, 26)}</div>
      <div style="font-weight:800;font-size:17px;color:${C.cream}">${p.name}</div>
      <div style="font-size:12px;letter-spacing:.18em;font-weight:700;color:${C.caramel};margin:2px 0 8px">${p.code}</div>
      <div style="font-size:13px;line-height:1.38">${p.does}</div></div>`).join("")}
  </div>

  <!-- features -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px">
    ${features.map(([ic, t, d]) => `<div class="card" style="padding:14px 18px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">${icon(ic, 22)}<div style="font-weight:800;font-size:17px;color:${C.cream}">${t}</div></div>
      <div style="font-size:13.5px;line-height:1.42">${d}</div></div>`).join("")}
  </div>

  <!-- footer -->
  <div style="margin-top:auto">
    <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px">
      ${tech.map((t) => `<span style="padding:5px 12px;border-radius:99px;border:1px solid ${C.border};font-size:13px;font-weight:700">${t}</span>`).join("")}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:30px;border-top:1px solid ${C.border};padding-top:12px">
      <div style="font-size:15px;line-height:1.7">
        <div><b style="color:${C.cream}">Proponents:</b> <span style="display:inline-block;width:480px;border-bottom:1px dashed ${C.border}">&nbsp;</span></div>
        <div><b style="color:${C.cream}">Adviser:</b> <span style="display:inline-block;width:300px;border-bottom:1px dashed ${C.border}">&nbsp;</span> &nbsp; <b style="color:${C.cream}">School:</b> <span style="display:inline-block;width:260px;border-bottom:1px dashed ${C.border}">&nbsp;</span></div>
      </div>
      <div style="text-align:right;font-size:14px;line-height:1.5"><b style="color:${C.cream}">Verified:</b> 218 unit tests · 13 end-to-end flows<br/>database & RLS tests · WCAG contrast audit</div>
    </div>
  </div>
</div></body></html>`;
writeFileSync(path.join(DIR, "poster.html"), poster);

/* ============================================================ BOOTH BACKDROP */
// 3.0 m x 2.4 m tension-fabric wall. 1500 x 1200 CSS px => 6000 x 4800 px at 4x (~51 dpi, standard for large format).
const backdrop = `<!doctype html><html><head><meta charset="utf-8"><title>Booth backdrop</title><style>${fontsCss()}
html,body{width:1500px;height:1200px;overflow:hidden}
.wall{position:relative;width:1500px;height:1200px;background:radial-gradient(900px 600px at 50% 30%, rgba(196,138,90,.24), transparent 70%),radial-gradient(800px 500px at 50% 110%, rgba(107,74,58,.45), transparent 70%),${C.espresso};display:flex;flex-direction:column;align-items:center;padding-top:70px}
</style></head><body><div class="wall" id="backdrop">
  ${tree(150)}
  <div class="eyebrow" style="font-size:20px;margin-top:26px">JJ Furniture Shop and Enterprises · Valencia City, Bukidnon</div>
  <div class="serif" style="font-size:104px;color:${C.cream};margin-top:8px;font-weight:500">JJ Furniture Management System</div>
  <div class="serif" style="font-style:italic;font-size:36px;margin-top:6px">From the first sketch to the front door</div>
  <div style="width:1240px;margin-top:70px">${stageTracker(64, 20)}</div>
  <div style="display:flex;gap:26px;margin-top:70px">
    ${PORTALS.map((p) => `<div style="display:flex;align-items:center;gap:14px;padding:14px 26px;border-radius:99px;border:2px solid ${C.caramel};background:rgba(54,37,30,.8)">${icon(p.icon, 30)}<span style="font-weight:800;font-size:24px;color:${C.cream}">${p.name}</span></div>`).join("")}
  </div>
  <div style="position:absolute;bottom:56px;font-size:22px;letter-spacing:.3em;font-weight:800;color:${C.latte};text-transform:uppercase">Modern · Warm · Luxurious</div>
</div></body></html>`;
writeFileSync(path.join(DIR, "backdrop.html"), backdrop);

/* ============================================================ ROLL-UP BANNER */
// 85 x 200 cm. 850 x 2000 CSS px => 2550 x 6000 px at 3x (~76 dpi).
const rollup = `<!doctype html><html><head><meta charset="utf-8"><title>Roll-up banner</title><style>${fontsCss()}
html,body{width:850px;height:2000px;overflow:hidden}
.b{position:relative;width:850px;height:2000px;background:radial-gradient(700px 600px at 50% 18%, rgba(196,138,90,.22), transparent 70%),${C.espresso};padding:90px 70px;text-align:center}
</style></head><body><div class="b" id="rollup">
  <div style="display:flex;justify-content:center">${tree(130)}</div>
  <div class="serif" style="font-size:74px;line-height:1.05;color:${C.cream};margin-top:30px;font-weight:500">Design your furniture in 3D</div>
  <div style="font-size:28px;line-height:1.45;margin-top:22px">Pick the type, size, wood and finish, see it at true scale, and request an official quotation in seconds.</div>
  <div style="margin:60px auto 0;width:640px;border-radius:30px;overflow:hidden;border:2px solid ${C.caramel};box-shadow:0 0 50px rgba(196,138,90,.35)"><img src="${shot("model3d")}" style="display:block;width:100%"/></div>
  <div style="margin-top:70px;display:grid;gap:22px;text-align:left">
    ${[["Box", "Live 3D preview with a 165 cm figure"], ["MailCheck", "Quotation by email · accept online"], ["ShieldCheck", "Production starts after a verified 30%"], ["MapPinned", "Track all 7 stages to your door"]].map(([ic, t]) => `<div style="display:flex;align-items:center;gap:20px;padding:22px 28px;border-radius:22px;background:rgba(54,37,30,.85);border:1px solid ${C.border}">${icon(ic, 40)}<span style="font-size:30px;font-weight:800;color:${C.cream}">${t}</span></div>`).join("")}
  </div>
  <div style="position:absolute;left:0;right:0;bottom:120px">
    <div class="eyebrow" style="font-size:22px">Try it at the kiosk</div>
    <div class="wordmark" style="font-weight:900;font-size:64px;color:${C.cream};margin-top:8px">JJ Furniture</div>
    <div style="font-size:22px;margin-top:4px">Shop and Enterprises · Valencia City, Bukidnon</div>
  </div>
</div></body></html>`;
writeFileSync(path.join(DIR, "rollup.html"), rollup);

/* ======================================================= COUNTER FRONT WRAP */
// 2.0 m x 1.0 m counter front. 1000 x 500 CSS px.
const counter = `<!doctype html><html><head><meta charset="utf-8"><style>${fontsCss()}
html,body{width:1000px;height:500px;overflow:hidden}</style></head><body>
<div id="counter" style="width:1000px;height:500px;background:linear-gradient(180deg,${C.card},${C.espresso});display:flex;align-items:center;justify-content:center;gap:34px;border-top:6px solid ${C.caramel}">
  ${tree(120)}<div><div class="wordmark" style="font-weight:900;font-size:76px;color:${C.cream};line-height:1">JJ Furniture</div><div class="eyebrow" style="font-size:18px;margin-top:10px">Management System · Live demo</div></div>
</div></body></html>`;
writeFileSync(path.join(DIR, "counter.html"), counter);
console.log("pages written:", ["poster", "backdrop", "rollup", "counter"].join(", "));
