import type { MemoryCategory } from "../interfaces/index.js";
import { parseLLMJson } from "../utils/parse-llm-json.js";

export const CATEGORY_DESCRIPTIONS: Record<MemoryCategory, string> = {
  identity: "Who the user is: name, location, age, nationality, background",
  preferences: "Likes, dislikes, tastes — food, music, media, aesthetics",
  goals: "Things the user wants to achieve, aspirations, plans",
  technical: "Programming languages, tools, frameworks, editors, OS, hardware",
  infrastructure: "Servers, ports, services, IPs, configs, self-hosted apps",
  projects: "Current or past projects the user is working on",
  relationships: "People the user mentions: friends, family, colleagues",
  life_events: "Significant events: moves, jobs, milestones, purchases",
  health: "Health conditions, fitness habits, medical notes",
  finance: "Financial situation, investments, spending patterns",
  assistant: "Instructions for the assistant: how to behave, what to avoid",
  knowledge: "Things the user knows or has learned that are worth retaining",
  other: "Important facts that don't fit other categories",
};

const CATEGORIES_LIST = Object.entries(CATEGORY_DESCRIPTIONS)
  .map(([k, v]) => `  - ${k}: ${v}`)
  .join("\n");

export function buildExtractionPrompt(
  customInstructions?: string,
): string {
  return `You are a memory extraction system for a personal AI assistant.

Your job is to extract important, durable facts from a conversation that should be remembered long-term.

## Categories
Classify each memory into one of these categories:
${CATEGORIES_LIST}

## Memory types
- fact: A stable true statement (persists until updated)
- preference: Something the user likes/dislikes/prefers (strengthens with repetition)
- episode: A time-bound event or state (decays unless significant)

## Rules
1. Extract ONLY facts that are genuinely worth remembering long-term
2. Each memory must be a clear, self-contained statement in third person ("The user prefers...")
3. Do NOT extract: greetings, small talk, questions without answers, filler content
4. Do NOT extract things that are obviously temporary (unless classifying as episode)
5. Be specific: "The user uses Neovim with Lua config" > "The user uses an editor"
6. Capture technical details precisely: exact model names, port numbers, OS versions
7. If the user gives an explicit instruction to remember something, always extract it
${customInstructions ? `\n## Additional instructions\n${customInstructions}` : ""}

## Output format
Return a JSON object with this exact structure:
{
  "memories": [
    {
      "memory": "The user prefers TypeScript over Python for backend work.",
      "category": "technical",
      "memoryType": "preference",
      "eventDate": null
    }
  ]
}

If there is nothing worth remembering, return: {"memories": []}
Return ONLY the JSON. No markdown, no explanation.`;
}

export interface ExtractedMemory {
  memory: string;
  category: MemoryCategory;
  memoryType: "fact" | "preference" | "episode";
  eventDate: string | null;
}

export function parseExtractionResponse(raw: string): ExtractedMemory[] {
  const parsed = parseLLMJson(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>)["memories"])
  ) {
    return [];
  }

  const memories = (parsed as { memories: unknown[] }).memories;
  return memories.filter(isValidExtractedMemory);
}

function isValidExtractedMemory(item: unknown): item is ExtractedMemory {
  if (typeof item !== "object" || item === null) return false;
  const m = item as Record<string, unknown>;
  return (
    typeof m["memory"] === "string" &&
    m["memory"].length > 0 &&
    typeof m["category"] === "string" &&
    typeof m["memoryType"] === "string"
  );
}
