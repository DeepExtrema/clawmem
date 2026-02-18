// #58: Unit tests for buildProfileSummary
import { describe, it, expect } from "vitest";
import { buildProfileSummary } from "../src/prompts/profile.js";
import type { UserProfile, MemoryItem } from "../src/interfaces/index.js";

function mem(text: string): MemoryItem {
  return {
    id: "test",
    memory: text,
    hash: "abc",
    userId: "u1",
    category: "other",
    memoryType: "fact",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    isLatest: true,
  };
}

function emptyProfile(): UserProfile {
  return {
    userId: "u1",
    static: { identity: [], preferences: [], technical: [], relationships: [] },
    dynamic: { goals: [], projects: [], lifeEvents: [] },
    other: [],
  };
}

describe("buildProfileSummary", () => {
  it("returns empty string for empty profile", () => {
    const result = buildProfileSummary(emptyProfile());
    expect(result).toBe("");
  });

  it("renders a single category", () => {
    const profile = emptyProfile();
    profile.static.identity = [mem("Name is Alice")];
    const result = buildProfileSummary(profile);
    expect(result).toContain("### Identity");
    expect(result).toContain("- Name is Alice");
    expect(result).not.toContain("### Preferences");
  });

  it("renders all populated categories", () => {
    const profile = emptyProfile();
    profile.static.identity = [mem("Alice")];
    profile.static.preferences = [mem("Likes coffee")];
    profile.static.technical = [mem("Uses TypeScript")];
    profile.static.relationships = [mem("Works with Bob")];
    profile.dynamic.goals = [mem("Ship v1")];
    profile.dynamic.projects = [mem("ClawMem")];
    profile.dynamic.lifeEvents = [mem("Started new job")];
    profile.other = [mem("Misc fact")];

    const result = buildProfileSummary(profile);
    expect(result).toContain("### Identity");
    expect(result).toContain("### Preferences");
    expect(result).toContain("### Technical");
    expect(result).toContain("### Relationships");
    expect(result).toContain("### Goals");
    expect(result).toContain("### Projects");
    expect(result).toContain("### Life Events");
    expect(result).toContain("### Other");
  });

  it("lists multiple items in a category", () => {
    const profile = emptyProfile();
    profile.static.preferences = [mem("Likes coffee"), mem("Prefers dark mode")];
    const result = buildProfileSummary(profile);
    expect(result).toContain("- Likes coffee");
    expect(result).toContain("- Prefers dark mode");
  });
});
