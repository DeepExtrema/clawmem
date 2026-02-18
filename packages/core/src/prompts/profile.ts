import type { MemoryItem, UserProfile } from "../interfaces/index.js";

export function buildProfilePrompt(memories: MemoryItem[]): string {
  const list = memories
    .map((m) => `- [${m.category ?? "other"}] ${m.memory}`)
    .join("\n");

  return `You are a user profile builder.

Given this list of facts about a user, classify them into static (long-term stable) and dynamic (current/temporary).

## Memories
${list}

## Output format
{
  "static": {
    "identity": ["fact1", ...],
    "preferences": ["fact1", ...],
    "technical": ["fact1", ...],
    "relationships": ["fact1", ...]
  },
  "dynamic": {
    "goals": ["fact1", ...],
    "projects": ["fact1", ...],
    "lifeEvents": ["fact1", ...]
  }
}

Return ONLY the JSON.`;
}

export function buildProfileSummary(profile: UserProfile): string {
  const sections: string[] = [];

  const addSection = (title: string, items: MemoryItem[]) => {
    if (items.length > 0) {
      sections.push(`### ${title}\n${items.map((m) => `- ${m.memory}`).join("\n")}`);
    }
  };

  addSection("Identity", profile.static.identity);
  addSection("Preferences", profile.static.preferences);
  addSection("Technical", profile.static.technical);
  addSection("Relationships", profile.static.relationships);
  addSection("Goals", profile.dynamic.goals);
  addSection("Projects", profile.dynamic.projects);
  addSection("Life Events", profile.dynamic.lifeEvents);
  addSection("Other", profile.other);

  return sections.join("\n\n");
}
