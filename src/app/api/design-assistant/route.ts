import { z } from "zod";
import { AiUnavailable, aiDesignerEnabled, designWithGemini } from "@/lib/server/ai-designer";
import { clientIp } from "@/lib/server/request-meta";

/**
 * AI designer: a description and/or a photo -> checked configurator choices.
 * Public (the designer works without an account), so it is size- and rate-limited.
 * When Gemini is off, busy or fails, the browser falls back to the built-in rules.
 */
export const maxDuration = 60;

const body = z.object({
  text: z.string().trim().max(600).optional().default(""),
  image: z
    .object({
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      // ~1.4 MB of base64: the browser shrinks photos to 1024 px first
      data: z.string().max(1_900_000).regex(/^[A-Za-z0-9+/]+=*$/),
    })
    .optional(),
});

const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 15;
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_WINDOW) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded on a long-lived instance
  return false;
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return json({ ai: aiDesignerEnabled() });
}

export async function POST(req: Request) {
  if (!aiDesignerEnabled()) return json({ code: "AI_OFF" }, 503);
  let parsed;
  try {
    parsed = body.safeParse(await req.json());
  } catch {
    return json({ code: "BAD_REQUEST" }, 400);
  }
  if (!parsed.success || (!parsed.data.text && !parsed.data.image)) return json({ code: "BAD_REQUEST" }, 400);
  if (limited(await clientIp())) return json({ code: "RATE_LIMITED", message: "Too many requests. Please wait a few minutes." }, 429);
  try {
    const result = await designWithGemini({ text: parsed.data.text, image: parsed.data.image });
    return json({ ok: true, result });
  } catch (e) {
    const reason = e instanceof AiUnavailable ? e.reason : "failed";
    return json({ code: reason === "busy" ? "AI_BUSY" : "AI_FAILED" }, reason === "busy" ? 429 : 502);
  }
}
