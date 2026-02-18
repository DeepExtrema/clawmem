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

export function parseEntityExtractionResponse(raw: string): {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
} {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { entities: [], relations: [] };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { entities: [], relations: [] };
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { entities: [], relations: [] };
  }

  const p = parsed as Record<string, unknown>;
  return {
    entities: Array.isArray(p["entities"])
      ? (p["entities"] as ExtractedEntity[])
      : [],
    relations: Array.isArray(p["relations"])
      ? (p["relations"] as ExtractedRelation[])
      : [],
  };
}
