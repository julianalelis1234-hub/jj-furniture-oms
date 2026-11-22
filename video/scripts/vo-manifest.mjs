// Measures every public/vo/<id>.mp3 and writes src/vo-manifest.json ({ id: seconds }).
// Lines without a file are simply absent: the video then shows that caption on time, silently.
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const dir = path.resolve(import.meta.dirname, "../public/vo");
const out = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".mp3")).sort()) {
  const d = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, f)]).toString().trim();
  out[f.replace(/\.mp3$/, "")] = Math.round(Number(d) * 1000) / 1000;
}
writeFileSync(path.resolve(import.meta.dirname, "../src/vo-manifest.json"), JSON.stringify(out, null, 2) + "\n");
console.log(out);
