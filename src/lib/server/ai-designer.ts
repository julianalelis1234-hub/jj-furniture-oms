import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { AI_DESIGN_SCHEMA, aiSystemPrompt, normalizeAiDesign, type AiDesignResult } from "@/lib/domain/ai-design";

/**
 * Gemini call for the AI designer. The key lives only on the server
 * (GEMINI_API_KEY in Vercel); GEMINI_MODEL picks the model.
 */
export const aiDesignerEnabled = () => !!process.env.GEMINI_API_KEY;
/** Tried in order; a model name Google retired (404) falls through to the next. */
const MODELS = () => [...new Set([process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"].filter(Boolean) as string[])];

export class AiUnavailable extends Error {
  constructor(public reason: "off" | "busy" | "failed") { super(reason); }
}

export async function designWithGemini(input: { text?: string; image?: { mimeType: string; data: string } }): Promise<AiDesignResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiUnavailable("off");
  // GEMINI_BASE_URL is only for local tests against a stand-in server
  // v1beta: the "-latest" model names and JSON-schema output are served there
  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta", ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) });
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.data } });
  parts.push({ text: input.text?.trim() ? `Customer's description:\n"""${input.text.trim()}"""` : "The customer sent only the photo. Describe the furniture in it." });
  let lastStatus: number | undefined;
  const deadline = Date.now() + 45_000; // stay inside the function time limit across all tries
  for (const model of MODELS()) {
    const left = deadline - Date.now();
    if (left < 5_000) break;
    try {
      const ask = (thinking: boolean) => ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: aiSystemPrompt(),
          responseMimeType: "application/json",
          responseJsonSchema: AI_DESIGN_SCHEMA,
          temperature: 0.2,
          maxOutputTokens: 2048,
          // filling a form needs no long reasoning: minimal thinking answers in a few seconds
          ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
          abortSignal: AbortSignal.timeout(Math.min(25_000, left)),
        },
      });
      let res;
      try {
        res = await ask(true);
      } catch (e) {
        const st = (e as { status?: number }).status;
        // a model without the thinking setting rejects it (400): ask again without it
        if (st === 400 && /think/i.test(e instanceof Error ? e.message : "")) res = await ask(false);
        // "high demand" is often a few seconds long: one more try on the same model
        else if (st === 503 && deadline - Date.now() > 10_000) { await new Promise((r) => setTimeout(r, 1500)); res = await ask(true); }
        else throw e;
      }
      const out = normalizeAiDesign(JSON.parse(res.text ?? "null"));
      if (!out) throw new AiUnavailable("failed");
      return out;
    } catch (e) {
      if (e instanceof AiUnavailable) throw e;
      const aborted = e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
      lastStatus = aborted ? 504 : (e as { status?: number }).status;
      console.warn(`[ai-designer] Gemini (${model}) request failed:`, lastStatus ?? "", e instanceof Error ? e.message.slice(0, 200) : "");
      // unknown model (404), out of this model's free quota (429), overloaded / failing (500, 503) or
      // too slow (504) -> try the next model; anything else (bad key, bad request) fails on every model
      if (![404, 429, 500, 503, 504].includes(lastStatus ?? 0)) break;
    }
  }
  throw new AiUnavailable(lastStatus === 429 || lastStatus === 503 || lastStatus === 504 ? "busy" : "failed");
}
