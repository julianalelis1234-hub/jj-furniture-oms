// Generates any MISSING narration line (public/vo/<id>.mp3) with the ElevenLabs API.
//
//   ELEVENLABS_API_KEY=... node scripts/generate-vo.mjs        (or put the key in video/.env.local)
//
// - The key is read from the environment or video/.env.local only. It is never printed or written anywhere.
// - Without a key nothing is generated: the video still renders, each caption plays on time, silently.
// - Existing files are kept (delete one to re-generate it). Run `node scripts/vo-manifest.mjs` afterwards.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "fV23OYSdBKTR4cQABxRV"; // "Clementine 2.0 – Upbeat, Engaging, Clear" (English, female)
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3";

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const env = path.join(root, ".env.local");
  if (!existsSync(env)) return null;
  const m = readFileSync(env, "utf8").match(/^\s*ELEVENLABS_API_KEY\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : null;
}

// read the script without a TS toolchain: the entries are plain object literals
const src = readFileSync(path.join(root, "src/script.ts"), "utf8");
const lines = [...src.matchAll(/\{ id: "(\w+)", at: [\d.]+,(?: tags: "([^"]*)",)? text: "([^"]+)" \}/g)].map(([, id, tags, text]) => ({ id, tags, text }));

const key = apiKey();
const missing = lines.filter((l) => !existsSync(path.join(root, "public/vo", `${l.id}.mp3`)));
if (!missing.length) { console.log("All narration lines already exist."); process.exit(0); }
if (!key) {
  console.log(`No ELEVENLABS_API_KEY: ${missing.length} line(s) will render as silent, caption-synced lines (${missing.map((l) => l.id).join(", ")}).`);
  process.exit(0);
}
for (const l of missing) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: `${l.tags ? l.tags + " " : ""}${l.text}`, model_id: MODEL_ID }),
  });
  if (!res.ok) { console.error(`${l.id}: ElevenLabs returned HTTP ${res.status}`); process.exitCode = 1; continue; }
  writeFileSync(path.join(root, "public/vo", `${l.id}.mp3`), Buffer.from(await res.arrayBuffer()));
  console.log(`${l.id}: saved`);
}
