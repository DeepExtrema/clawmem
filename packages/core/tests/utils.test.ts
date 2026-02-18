// #59: cosineSimilarity edge case tests
// #60: hashContent normalization tests
import { describe, it, expect } from "vitest";
import { cosineSimilarity, hashContent } from "../src/utils/index.js";

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 5);
  });

  it("returns -1.0 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for both zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("hashContent", () => {
  it("same content produces same hash", () => {
    expect(hashContent("hello world")).toBe(hashContent("hello world"));
  });

  it("case is normalized (same hash)", () => {
    expect(hashContent("Hello World")).toBe(hashContent("hello world"));
  });

  it("whitespace is normalized (same hash)", () => {
    expect(hashContent("  hello world  ")).toBe(hashContent("hello world"));
  });

  it("different content produces different hash", () => {
    expect(hashContent("hello")).not.toBe(hashContent("world"));
  });

  it("empty string produces a hash", () => {
    const hash = hashContent("");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("hash is exactly 16 hex characters", () => {
    const hash = hashContent("some content");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
