// Shared brand pieces for the poster and booth artwork (Smoked Espresso dark theme, the app's own tokens).
import { createRequire } from "node:module";
import path from "node:path";

const req = createRequire(path.resolve(import.meta.dirname, "../video/package.json"));
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const Lucide = req("lucide-react");

export const C = { espresso: "#2B1D17", card: "#36251E", mocha: "#6B4A3A", caramel: "#C48A5A", latte: "#E7D6C1", cream: "#FAF6F0", border: "#4D3E36" };

/** Lucide icon as inline SVG markup */
export const icon = (name, size = 32, color = C.caramel, stroke = 1.7) =>
  renderToStaticMarkup(React.createElement(Lucide[name], { size, color, strokeWidth: stroke }));

export const fontsCss = (base = "../fonts") => `
@font-face { font-family: "EB Garamond"; src: url(${base}/EBGaramond.woff2) format("woff2"); font-weight: 100 1000; }
@font-face { font-family: "EB Garamond"; src: url(${base}/EBGaramond-Italic.woff2) format("woff2"); font-weight: 100 1000; font-style: italic; }
@font-face { font-family: "Nunito Sans"; src: url(${base}/NunitoSans.woff2) format("woff2"); font-weight: 100 1000; }
@font-face { font-family: "Nunito"; src: url(${base}/Nunito.woff2) format("woff2"); font-weight: 100 1000; }
:root { --espresso:${C.espresso}; --card:${C.card}; --mocha:${C.mocha}; --caramel:${C.caramel}; --latte:${C.latte}; --cream:${C.cream}; --border:${C.border}; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--espresso); color: var(--latte); font-family: "Nunito Sans", sans-serif; -webkit-font-smoothing: antialiased; }
.serif { font-family: "EB Garamond", serif; }
.wordmark { font-family: "Nunito", sans-serif; }
.eyebrow { font-weight: 800; letter-spacing: .32em; text-transform: uppercase; color: var(--caramel); }
`;

/** The app's swaying-tree mark (static pose), dark-mode colours */
export const tree = (w = 120) => `<svg viewBox="0 0 120 140" width="${w}" height="${(w * 140) / 120}" style="overflow:visible;filter:drop-shadow(0 0 ${w / 5}px rgba(196,138,90,.45))">
<path d="M18 134 H102" stroke="${C.border}" stroke-width="1.5" stroke-linecap="round"/>
<path fill="${C.latte}" d="M56 134 C57 118 56 104 54 92 C51 84 46 80 42 76 L45 74 C50 78 54 82 57 86 C58 78 58 70 57 62 L63 62 C62 72 62 80 63 86 C66 81 71 77 76 74 L78 76 C73 80 68 85 66 92 C64 104 63 118 64 134 Z"/>
<ellipse cx="60" cy="44" rx="40" ry="30" fill="${C.mocha}"/>
<ellipse cx="44" cy="58" rx="26" ry="19" fill="${C.caramel}"/><ellipse cx="78" cy="56" rx="27" ry="20" fill="${C.caramel}"/>
<ellipse cx="60" cy="36" rx="25" ry="19" fill="${C.latte}"/>
<path d="M60 20 C61 28 61 36 60 46" stroke="${C.espresso}" stroke-opacity=".45" stroke-width="1.2" fill="none" stroke-linecap="round"/>
<path d="M84 92 c4 -3 9 -2 10 2 c-4 3 -9 2 -10 -2 z" fill="${C.caramel}" opacity=".8"/></svg>`;

export const STAGES = ["Waiting for Confirmation", "Confirmed", "In Production", "Completed / For Inspection", "Ready for Delivery", "Out for Delivery", "Delivered"];

export const PORTALS = [
  { code: "O-01", name: "Owner", icon: "Crown", does: "Approvals, quality inspection, production priority, live shop KPIs" },
  { code: "S-01", name: "Store Staff", icon: "ClipboardList", does: "Walk-in & phone orders, official quotations, payments, delivery scheduling" },
  { code: "C-01", name: "Craftsmen", icon: "Hammer", does: "Priority-sorted jobs on a phone, specs without prices, ready-for-inspection" },
  { code: "D-01", name: "Delivery Driver", icon: "Truck", does: "Trips, exact cash to collect, works offline and syncs when signal returns" },
  { code: "CU-01", name: "Customer", icon: "ShoppingBag", does: "Design in 3D, request a quote, accept online, track all 7 stages" },
];

export const stageTracker = (size = 46, label = 15, done = 7) => `
<div style="display:flex;align-items:flex-start;justify-content:space-between">
${STAGES.map((s, i) => `
  ${i ? `<div style="flex:1;height:3px;margin-top:${size / 2 - 1}px;background:${i < done ? C.caramel : C.border}"></div>` : ""}
  <div style="display:flex;flex-direction:column;align-items:center;width:${size * 2.6}px">
    <div style="width:${size}px;height:${size}px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${size * 0.42}px;color:${C.cream};background:${i < done ? (i === 6 ? C.caramel : C.mocha) : "transparent"};border:2px solid ${i < done ? C.caramel : C.border};box-shadow:${i === 6 ? "0 0 22px rgba(196,138,90,.6)" : "none"}">${i < done ? "✓" : i + 1}</div>
    <div style="margin-top:10px;text-align:center;font-weight:${i === 6 ? 800 : 600};font-size:${label}px;line-height:1.2;color:${i === 6 ? C.cream : C.latte}">${s}</div>
  </div>`).join("")}
</div>`;
