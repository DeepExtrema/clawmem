/**
 * Query rewriting — P4-5
 *
 * Expands short or ambiguous search queries using the LLM to improve recall.
 * Falls back to the original query if LLM is unavailable.
 */

export function buildQueryRewritePrompt(query: string): string {
  return `You are a search query expansion system for a personal memory store.

Given a short or potentially ambiguous search query, expand it into a clearer, more specific query
that will retrieve better results from a semantic vector search.

Rules:
- Keep the expanded query concise (1-2 sentences max)
- Preserve the original intent
- Add synonyms or related terms if helpful
- If the query is already clear and specific, return it unchanged
- Return ONLY the expanded query text, no explanation

Original query: ${query}

Expanded query:`;
}

export async function rewriteQuery(
  query: string,
  llm: { complete(messages: Array<{ role: string; content: string }>): Promise<string> },
  opts: { minLength?: number } = {},
): Promise<string> {
  // Only rewrite short/vague queries
  const minLength = opts.minLength ?? 15;
  if (query.length >= minLength && query.split(" ").length >= 4) {
    return query;
  }

  try {
    const expanded = await llm.complete([
      { role: "user", content: buildQueryRewritePrompt(query) },
    ]);
    const cleaned = expanded.trim().replace(/^["']|["']$/g, "");
    return cleaned.length > 5 ? cleaned : query;
  } catch {
    // Fallback to original
    return query;
  }
}
