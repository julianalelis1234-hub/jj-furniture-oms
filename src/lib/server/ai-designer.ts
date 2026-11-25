import "server-only";
import { GoogleGenAI } from "@google/genai";
import { AI_DESIGN_SCHEMA, aiSystemPrompt, normalizeAiDesign, type AiDesignResult } from "@/lib/domain/ai-design";

/**
 * Gemini call for the AI designer. The key lives only on the server
 * (GEMINI_API_KEY in Vercel); GEMINI_MODEL picks the model.
 */
export const aiDesignerEnabled = () => !!process.env.GEMINI_API_KEY;
const MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-latest";

export class AiUnavailable extends Error {
  constructor(public reason: "off" | "busy" | "failed") { super(reason); }
}

export async function designWithGemini(input: { text?: string; image?: { mimeType: string; data: string } }): Promise<AiDesignResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiUnavailable("off");
  // GEMINI_BASE_URL is only for local tests against a stand-in server
  const ai = new GoogleGenAI({ apiKey, ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) });
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.data } });
  parts.push({ text: input.text?.trim() ? `Customer's description:\n"""${input.text.trim()}"""` : "The customer sent only the photo. Describe the furniture in it." });
  try {
    const res = await ai.models.generateContent({
      model: MODEL(),
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
    const status = (e as { status?: number }).status;
    console.warn("[ai-designer] Gemini request failed:", status ?? "", e instanceof Error ? e.message.slice(0, 200) : "");
    throw new AiUnavailable(status === 429 ? "busy" : "failed");
  }
}
