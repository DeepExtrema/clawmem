/**
 * Parse JSON from LLM output, handling common quirks:
 * - Markdown code fences (```json ... ```)
 * - DeepSeek-R1 <think>...</think> tags
 * - Extracting JSON from mixed text via regex fallback
 */
export function parseLLMJson(raw: string): unknown | null {
  // Strip <think>...</think> blocks (DeepSeek-R1)
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Strip markdown code fences
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Regex fallback: find first JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
