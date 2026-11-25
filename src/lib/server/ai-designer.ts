import "server-only";
import { GoogleGenAI } from "@google/genai";
import { AI_DESIGN_SCHEMA, aiSystemPrompt, normalizeAiDesign, type AiDesignResult } from "@/lib/domain/ai-design";

/**
 * Gemini call for the AI designer. The key lives only on the server
 * (GEMINI_API_KEY in Vercel); GEMINI_MODEL picks the model.
 */
export const aiDesignerEnabled = () => !!process.env.GEMINI_API_KEY;
/** Tried in order; a model name Google retired (404) falls through to the next. */
const MODELS = () => [...new Set([process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"].filter(Boolean) as string[])];

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
  for (const model of MODELS()) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: aiSystemPrompt(),
          responseMimeType: "application/json",
          responseJsonSchema: AI_DESIGN_SCHEMA,
          temperature: 0.2,
          maxOutputTokens: 2048,
          abortSignal: AbortSignal.timeout(25_000),
        },
      });
      const out = normalizeAiDesign(JSON.parse(res.text ?? "null"));
      if (!out) throw new AiUnavailable("failed");
      return out;
    } catch (e) {
      if (e instanceof AiUnavailable) throw e;
      lastStatus = (e as { status?: number }).status;
      console.warn(`[ai-designer] Gemini (${model}) request failed:`, lastStatus ?? "", e instanceof Error ? e.message.slice(0, 200) : "");
      if (lastStatus !== 404) break; // only an unknown model name is worth another try
    }
  }
  throw new AiUnavailable(lastStatus === 429 ? "busy" : "failed");
}
