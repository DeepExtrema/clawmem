import { describe, it, expect } from "vitest";
import { MockLLM, MockEmbedder, makeMemory } from "./helpers.js";
import type { LLM, LLMMessage, Embedder } from "../src/interfaces/index.js";

// ---------------------------------------------------------------------------
// Error-path tests (Fix #11)
// ---------------------------------------------------------------------------

describe("Error handling", () => {
  it("add() returns empty result when LLM extraction returns invalid JSON", async () => {
    const llm = new MockLLM(["this is not json"]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.add(
      [{ role: "user", content: "Hello" }],
      { userId: "u1" },
    );
    expect(result.added.length).toBe(0);
  });

  it("add() returns empty result when LLM returns empty string", async () => {
    const llm = new MockLLM([""]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.add(
      [{ role: "user", content: "Hello" }],
      { userId: "u1" },
    );
    expect(result.added.length).toBe(0);
  });

  it("add() returns empty result for empty messages array", async () => {
    const llm = new MockLLM([JSON.stringify({ memories: [] })]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.add([], { userId: "u1" });
    expect(result.added.length).toBe(0);
  });

  it("search() returns empty for empty query", async () => {
    const llm = new MockLLM([]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const results = await mem.search("", { userId: "u1", threshold: 0 });
    expect(results).toEqual([]);
  });

  it("get() returns null for nonexistent ID", async () => {
    const llm = new MockLLM([]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.get("nonexistent-id");
    expect(result).toBeNull();
  });

  it("getAll() returns empty array when no memories exist", async () => {
    const llm = new MockLLM([]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const results = await mem.getAll({ userId: "u1" });
    expect(results).toEqual([]);
  });

  it("delete() on nonexistent ID does not throw", async () => {
    const llm = new MockLLM([]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    await expect(mem.delete("nonexistent-id")).resolves.not.toThrow();
  });

  it("history() returns empty for nonexistent ID", async () => {
    const llm = new MockLLM([]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const history = await mem.history("nonexistent-id");
    expect(history).toEqual([]);
  });

  it("add() handles LLM returning <think> tags (DeepSeek-R1)", async () => {
    const llm = new MockLLM([
      `<think>Let me extract memories...</think>{"memories": [{"memory": "User is a developer", "category": "identity", "memoryType": "fact", "eventDate": null}]}`,
    ]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.add(
      [{ role: "user", content: "I am a developer" }],
      { userId: "u1" },
    );
    expect(result.added.length).toBe(1);
    expect(result.added[0]!.memory).toContain("developer");
  });

  it("add() handles LLM returning markdown-fenced JSON", async () => {
    const llm = new MockLLM([
      '```json\n{"memories": [{"memory": "User uses Vim", "category": "technical", "memoryType": "preference", "eventDate": null}]}\n```',
    ]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const result = await mem.add(
      [{ role: "user", content: "I use Vim" }],
      { userId: "u1" },
    );
    expect(result.added.length).toBe(1);
  });

  it("profile() returns structured empty profile when no memories", async () => {
    const llm = new MockLLM([]);
    const { memory: mem } = makeMemory(llm, new MockEmbedder());

    const profile = await mem.profile("u1");
    expect(profile.userId).toBe("u1");
    expect(profile.static.identity).toEqual([]);
    expect(profile.dynamic.goals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseLLMJson unit tests
// ---------------------------------------------------------------------------

import { parseLLMJson } from "../src/utils/parse-llm-json.js";

describe("parseLLMJson", () => {
  it("parses plain JSON", () => {
    expect(parseLLMJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(parseLLMJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("strips <think> tags", () => {
    expect(
      parseLLMJson('<think>reasoning here</think>{"a": 1}'),
    ).toEqual({ a: 1 });
  });

  it("extracts JSON from mixed text via regex", () => {
    expect(parseLLMJson('Here is the result: {"a": 1} done')).toEqual({ a: 1 });
  });

  it("returns null for non-JSON input", () => {
    expect(parseLLMJson("not json at all")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLLMJson("")).toBeNull();
  });
});
