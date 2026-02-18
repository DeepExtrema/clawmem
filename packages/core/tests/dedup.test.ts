import { describe, it, expect } from "vitest";
import { deduplicate } from "../src/dedup.js";
import type { MemoryItem, VectorStore, VectorStoreResult } from "../src/interfaces/index.js";
import { MockLLM, MockEmbedder } from "./helpers.js";
import { SqliteVecStore } from "../src/backends/sqlite-vec.js";
import { hashContent } from "../src/utils/index.js";

function makeItem(overrides: Partial<MemoryItem> & { embedding?: number[] } = {}): MemoryItem & { embedding: number[] } {
  const memory = overrides.memory ?? "Test memory";
  return {
    id: overrides.id ?? "new-id",
    memory,
    userId: overrides.userId ?? "u1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isLatest: true,
    version: 1,
    hash: hashContent(memory),
    embedding: overrides.embedding ?? [1, 0, 0, 0],
    ...overrides,
  };
}

describe("deduplicate()", () => {
  it("returns skip for exact hash match", async () => {
    const store = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
    const embedder = new MockEmbedder();
    const llm = new MockLLM([]);

    // Pre-populate a memory
    const existing = makeItem({ id: "existing-1", memory: "User prefers dark mode" });
    await store.insert([existing.embedding], [existing.id], [{
      memory: existing.memory,
      userId: existing.userId,
      hash: existing.hash,
      isLatest: true,
    }]);

    // Try to add the same content
    const newItem = makeItem({ memory: "User prefers dark mode" });

    const result = await deduplicate(newItem, store, embedder, llm);
    expect(result.decision.action).toBe("skip");
    expect(result.decision.reason).toContain("hash");
    expect(llm.idx).toBe(0); // LLM was never called

    store.close();
  });

  it("returns add when no similar memories exist", async () => {
    const store = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
    const embedder = new MockEmbedder();
    const llm = new MockLLM([]);

    const newItem = makeItem({ memory: "Completely unique memory" });

    const result = await deduplicate(newItem, store, embedder, llm);
    expect(result.decision.action).toBe("add");
    expect(result.decision.reason).toContain("No similar");

    store.close();
  });

  it("calls LLM when semantic match is above threshold", async () => {
    const store = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
    const embedder = new MockEmbedder();

    // Insert a memory with similar vector
    await store.insert(
      [[0.99, 0.01, 0, 0]],
      ["existing-1"],
      [{
        memory: "User likes TypeScript",
        userId: "u1",
        hash: "different-hash",
        isLatest: true,
      }],
    );

    const llm = new MockLLM([
      JSON.stringify({ action: "update", targetId: "existing-1", reason: "Newer info" }),
    ]);

    // New memory with very similar vector
    const newItem = makeItem({
      memory: "User prefers TypeScript over JavaScript",
      embedding: [1, 0, 0, 0],
    });

    const result = await deduplicate(newItem, store, embedder, llm, {
      semanticThreshold: 0.9,
    });

    expect(result.decision.action).toBe("update");
    expect(result.decision.targetId).toBe("existing-1");
    expect(llm.idx).toBe(1); // LLM was called

    store.close();
  });

  it("returns add when LLM response is unparseable", async () => {
    const store = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
    const embedder = new MockEmbedder();

    await store.insert(
      [[1, 0, 0, 0]],
      ["existing-1"],
      [{
        memory: "Something similar",
        userId: "u1",
        hash: "different-hash",
        isLatest: true,
      }],
    );

    const llm = new MockLLM(["not valid json at all"]);
    const newItem = makeItem({ embedding: [1, 0, 0, 0] });

    const result = await deduplicate(newItem, store, embedder, llm, {
      semanticThreshold: 0.9,
    });

    expect(result.decision.action).toBe("add");
    expect(result.decision.reason).toContain("Failed to parse");

    store.close();
  });
});
