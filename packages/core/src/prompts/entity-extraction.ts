export function buildEntityExtractionPrompt(): string {
  return `You are an entity and relationship extraction system.

Given a memory fact, extract the entities (people, technologies, projects, etc.) and
the relationships between them.

## Entity types
- person: A specific person (user themselves, friends, colleagues)
- technology: Software, programming languages, tools, frameworks
- project: A project, product, or codebase
- infrastructure: Servers, services, databases, ports
- location: Places, cities, countries
- organization: Companies, teams, communities
- concept: Abstract ideas, methodologies, patterns

## Output format
Return a JSON object:
{
  "entities": [
    { "name": "TypeScript", "type": "technology" },
    { "name": "user", "type": "person" }
  ],
  "relations": [
    { "source": "user", "relationship": "prefers", "target": "TypeScript", "confidence": 0.95 }
  ]
}

If no meaningful entities found, return: {"entities": [], "relations": []}
Return ONLY the JSON. No markdown.`;
}

export interface ExtractedEntity {
  name: string;
  type: string;
}

export interface ExtractedRelation {
  source: string;
  relationship: string;
  target: string;
  confidence?: number;
}

import { parseLLMJson } from "../utils/parse-llm-json.js";

function isValidEntity(item: unknown): item is ExtractedEntity {
  if (typeof item !== "object" || item === null) return false;
  const e = item as Record<string, unknown>;
  return typeof e["name"] === "string" && e["name"].length > 0 &&
         typeof e["type"] === "string" && e["type"].length > 0;
}

function isValidRelation(item: unknown): item is ExtractedRelation {
  if (typeof item !== "object" || item === null) return false;
  const r = item as Record<string, unknown>;
  return typeof r["source"] === "string" && r["source"].length > 0 &&
         typeof r["relationship"] === "string" && r["relationship"].length > 0 &&
         typeof r["target"] === "string" && r["target"].length > 0;
}

export function parseEntityExtractionResponse(raw: string): {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
} {
  const parsed = parseLLMJson(raw);

  if (typeof parsed !== "object" || parsed === null) {
    return { entities: [], relations: [] };
  }

  const p = parsed as Record<string, unknown>;
  return {
    entities: Array.isArray(p["entities"])
      ? (p["entities"] as unknown[]).filter(isValidEntity)
      : [],
    relations: Array.isArray(p["relations"])
      ? (p["relations"] as unknown[]).filter(isValidRelation)
      : [],
  };
}
