// Exports the semantic color tokens in src/app/globals.css to design/tokens.json
// (Tokens Studio / Figma Variables format, Light + Dark modes). Run: npm run tokens
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const block = (sel) => {
  const m = css.match(new RegExp(`${sel.replace(".", "\\.")} \\{([^}]*)\\}`));
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
};
const toSet = (vars) =>
  Object.fromEntries(
    Object.entries(vars)
      .filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)) // colours only (shadows / radius are not colour variables)
      .map(([k, v]) => [k, { $type: "color", $value: v }]),
  );
const light = block(":root");
const tokens = {
  "jj/light (Normal Mode)": toSet(light),
  "jj/dark": toSet(block(".dark")),
  "jj/shape": {
    radius: { $type: "dimension", $value: light.radius },
    "touch-target-min": { $type: "dimension", $value: "44px" },
    "touch-target-primary": { $type: "dimension", $value: "56px" },
    "font-size-body": { $type: "dimension", $value: "16px" },
    "shadow-surface-light": { $type: "boxShadow", $value: light["shadow-surface"] },
    "shadow-surface-dark": { $type: "boxShadow", $value: block(".dark")["shadow-surface"] },
  },
  $themes: [
    { name: "Normal (Light)", selectedTokenSets: { "jj/light (Normal Mode)": "enabled", "jj/shape": "enabled" } },
    { name: "Dark", selectedTokenSets: { "jj/dark": "enabled", "jj/shape": "enabled" } },
  ],
};
writeFileSync(new URL("../design/tokens.json", import.meta.url), JSON.stringify(tokens, null, 2) + "\n");
console.log(`Exported ${Object.keys(tokens["jj/light (Normal Mode)"]).length} color tokens × 2 modes to design/tokens.json`);
