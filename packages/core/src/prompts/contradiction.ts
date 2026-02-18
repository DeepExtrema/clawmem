export function buildDeduplicationPrompt(
  newMemory: string,
  existingMemories: Array<{ id: string; memory: string }>,
): string {
  const existing = existingMemories
    .map((m) => `id=${m.id}: ${m.memory}`)
    .join("\n");

  return `You are a memory deduplication system.

A new memory is being added. Check if it conflicts with, duplicates, or updates any existing memory.

## New memory
"${newMemory}"

## Existing memories
${existing}

## Actions
- "add": The new memory is genuinely new — no conflict or duplicate
- "update": The new memory supersedes an existing one (e.g., new preference contradicts old one)
- "skip": The new memory is a duplicate of an existing one (same information)
- "extend": The new memory adds detail to an existing one (both should be kept)

## Output format
{
  "action": "add" | "update" | "skip" | "extend",
  "targetId": "<id of existing memory if action is update/skip/extend, else null>",
  "reason": "<brief explanation>"
}

Return ONLY the JSON.`;
}

export interface DeduplicationDecision {
  action: "add" | "update" | "skip" | "extend";
  targetId: string | null;
  reason: string;
}

import { parseLLMJson } from "../utils/parse-llm-json.js";

export function parseDeduplicationResponse(raw: string): DeduplicationDecision | null {
  const parsed = parseLLMJson(raw);

  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  if (!["add", "update", "skip", "extend"].includes(p["action"] as string)) {
    return null;
  }

  return {
    action: p["action"] as DeduplicationDecision["action"],
    targetId: typeof p["targetId"] === "string" ? p["targetId"] : null,
    reason: typeof p["reason"] === "string" ? p["reason"] : "",
  };
}
