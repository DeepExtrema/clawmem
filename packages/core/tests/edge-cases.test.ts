// P6-2+P6-5: Targeted test gap-fill — temporal filtering, empty input, threshold edge cases
import { describe, it, expect } from "vitest";
import { MockLLM, MockEmbedder, makeMemory } from "./helpers.js";

const extractResponse = JSON.stringify({
  memories: [
    { memory: "User prefers dark mode", category: "preferences", memoryType: "preference", eventDate: "2025-06-15T00:00:00.000Z" },
  ],
});

const skipResponse = JSON.stringify({ action: "add", targetId: null, reason: "No similar" });

describe("Search — edge cases", () => {
  it("returns empty results when threshold=1.0 (nothing matches perfectly)", async () => {
    const llm = new MockLLM([extractResponse, skipResponse]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    await mem.add([{ role: "user", content: "I prefer dark mode" }], { userId: "u1" });

    const results = await mem.search("dark mode preferences", {
      userId: "u1",
      threshold: 1.0,
    });
    // MockEmbedder generates hash-based vectors — extremely unlikely to be identical
    expect(results.length).toBe(0);
  });

  it("returns empty results when threshold=0 (everything matches)", async () => {
    const llm = new MockLLM([extractResponse, skipResponse]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    await mem.add([{ role: "user", content: "I prefer dark mode" }], { userId: "u1" });

    const results = await mem.search("anything", {
      userId: "u1",
      threshold: 0,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("temporal filter fromDate excludes older memories", async () => {
    const llm = new MockLLM([extractResponse, skipResponse]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    await mem.add([{ role: "user", content: "I prefer dark mode" }], { userId: "u1" });

    // Memory has eventDate 2025-06-15, search from 2026-01-01 should exclude it
    const results = await mem.search("dark mode", {
      userId: "u1",
      fromDate: "2026-01-01",
      threshold: 0,
    });
    expect(results.length).toBe(0);
  });

  it("temporal filter toDate excludes newer memories", async () => {
    const llm = new MockLLM([extractResponse, skipResponse]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    await mem.add([{ role: "user", content: "I prefer dark mode" }], { userId: "u1" });

    // Memory has eventDate 2025-06-15, search to 2025-01-01 should exclude it
    const results = await mem.search("dark mode", {
      userId: "u1",
      toDate: "2025-01-01",
      threshold: 0,
    });
    expect(results.length).toBe(0);
  });

  it("temporal filter includes memories in range", async () => {
    const llm = new MockLLM([extractResponse, skipResponse]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    await mem.add([{ role: "user", content: "I prefer dark mode" }], { userId: "u1" });

    const results = await mem.search("dark mode", {
      userId: "u1",
      fromDate: "2025-01-01",
      toDate: "2025-12-31",
      threshold: 0,
    });
    expect(results.length).toBe(1);
  });
});

describe("Add — edge cases", () => {
  it("empty messages array returns empty result", async () => {
    const llm = new MockLLM([JSON.stringify({ memories: [] })]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.add([], { userId: "u1" });
    expect(result.added.length).toBe(0);
    expect(result.updated.length).toBe(0);
  });

  it("messages with no extractable facts returns empty result", async () => {
    const llm = new MockLLM([JSON.stringify({ memories: [] })]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.add([{ role: "user", content: "hi" }], { userId: "u1" });
    expect(result.added.length).toBe(0);
  });
});
