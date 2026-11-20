// Remove min-width breakpoint rules so the snapshot renders the phone layout at any canvas width.
import postcss from "postcss";
import fs from "node:fs";

const f = "design/portals.html";
let html = fs.readFileSync(f, "utf8");
const start = html.indexOf("<style>") + 7, end = html.indexOf("</style>");
const root = postcss.parse(html.slice(start, end));
let removed = 0;
root.walkAtRules("media", (r) => { if (/min-width|width\s*>=?/.test(r.params)) { r.remove(); removed++; } });
html = html.slice(0, start) + root.toString() + html.slice(end);
fs.writeFileSync(f, html);
console.log("removed breakpoint blocks:", removed, "bytes:", html.length);
