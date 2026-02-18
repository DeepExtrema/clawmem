import { describe, it, expect } from "vitest";
import { NoopReranker } from "../src/backends/noop-reranker.js";
import type { VectorStoreResult } from "../src/interfaces/index.js";

describe("NoopReranker", () => {
  const reranker = new NoopReranker();

  const items: VectorStoreResult[] = [
    { id: "a", score: 0.9, payload: { memory: "alpha" } },
    { id: "b", score: 0.7, payload: { memory: "beta" } },
    { id: "c", score: 0.5, payload: { memory: "gamma" } },
  ];

  it("returns items unchanged when no topK", async () => {
    const result = await reranker.rerank("query", items);
    expect(result).toEqual(items);
  });

  it("truncates to topK", async () => {
    const result = await reranker.rerank("query", items, 2);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("a");
    expect(result[1]?.id).toBe("b");
  });

  it("returns all items when topK >= length", async () => {
    const result = await reranker.rerank("query", items, 10);
    expect(result).toEqual(items);
  });

  it("handles empty input", async () => {
    const result = await reranker.rerank("query", []);
    expect(result).toEqual([]);
  });
});
