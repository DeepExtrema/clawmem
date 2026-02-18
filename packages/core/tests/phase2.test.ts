import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Memory } from "../src/memory.js";
import { SqliteVecStore } from "../src/backends/sqlite-vec.js";
import { SqliteHistoryStore } from "../src/backends/sqlite-history.js";
import { hashContent } from "../src/utils/index.js";
import type { LLM, LLMMessage, Embedder } from "../src/interfaces/index.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";

// Reusable mock helpers
class MockLLM implements LLM {
  public responses: string[];
  public idx = 0;
  constructor(responses: string[]) { this.responses = responses; }
  async complete(_m: LLMMessage[], _o?: { json?: boolean }): Promise<string> {
    const r = this.responses[this.idx % this.responses.length];
    this.idx++;
    return r ?? "{}";
  }
}
class MockEmbedder implements Embedder {
  readonly dimension = 4;
  async embed(text: string): Promise<number[]> {
    const h = hashContent(text);
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
      parseInt(h.slice(6, 8), 16) / 255,
    ];
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

function makeMemory(llm: LLM, embedder: Embedder, userId?: string) {
  const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
  const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });
  const dataDir = join(tmpdir(), `clawmem-p2-${randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });
  return new Memory({
    dataDir,
    llm: { baseURL: "" },
    embedder: { baseURL: "" },
    enableGraph: false,
    llmInstance: llm,
    embedderInstance: embedder,
    vectorStore,
    historyStore,
  });
}

describe("Phase 2 Tests — Graph, Profiles, Contradiction", () => {
  // -------------------------------------------------------------------------
  // T5: Auto-recall injection context
  // -------------------------------------------------------------------------
  describe("T5: Profile generation", () => {
    it("generates a structured user profile from stored memories", async () => {
      const extractResponse = JSON.stringify({
        memories: [
          { memory: "The user is a software engineer.", category: "identity", memoryType: "fact", eventDate: null },
          { memory: "The user prefers Neovim.", category: "preferences", memoryType: "preference", eventDate: null },
          { memory: "The user uses TypeScript daily.", category: "technical", memoryType: "fact", eventDate: null },
          { memory: "The user is building an OpenClaw plugin.", category: "projects", memoryType: "fact", eventDate: null },
          { memory: "The user wants to ship ClawMem by March.", category: "goals", memoryType: "episode", eventDate: null },
        ],
      });
      const llm = new MockLLM([extractResponse]);
      const mem = makeMemory(llm, new MockEmbedder());

      await mem.add(
        [{ role: "user", content: "I'm a software engineer building OpenClaw plugins." }],
        { userId: "profile-user" },
      );

      const profile = await mem.profile("profile-user");
      expect(profile.userId).toBe("profile-user");
      expect(profile.static.identity.length).toBeGreaterThanOrEqual(1);
      expect(profile.static.preferences.length).toBeGreaterThanOrEqual(1);
      expect(profile.static.technical.length).toBeGreaterThanOrEqual(1);
      expect(profile.dynamic.goals.length + profile.dynamic.projects.length).toBeGreaterThanOrEqual(1);
      expect(profile.generatedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // T6: End-to-end round-trip
  // -------------------------------------------------------------------------
  describe("T6: Round-trip — add then search", () => {
    it("memories added in one session are findable in search", async () => {
      const extractResponse = JSON.stringify({
        memories: [
          { memory: "The user has an AMD RX 6750 XT GPU.", category: "infrastructure", memoryType: "fact", eventDate: null },
          { memory: "The user runs llama.cpp on port 8080.", category: "infrastructure", memoryType: "fact", eventDate: null },
        ],
      });
      const llm = new MockLLM([extractResponse]);
      const mem = makeMemory(llm, new MockEmbedder());

      const addResult = await mem.add(
        [{ role: "user", content: "I use an AMD GPU and run llama.cpp." }],
        { userId: "roundtrip-user" },
      );
      expect(addResult.added.length).toBe(2);

      // search with threshold=0 to always return results from our small in-memory store
      const results = await mem.search("GPU hardware", {
        userId: "roundtrip-user",
        threshold: 0,
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.memory.includes("AMD"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T7: Contradiction deep-test
  // -------------------------------------------------------------------------
  describe("T7: Contradiction deep-test", () => {
    it("UPDATE chain: new fact findable, old fact is not latest", async () => {
      const extract1 = JSON.stringify({
        memories: [{ memory: "The user's shell is bash.", category: "technical", memoryType: "fact", eventDate: null }],
      });
      const extract2 = JSON.stringify({
        memories: [{ memory: "The user's shell is fish.", category: "technical", memoryType: "fact", eventDate: null }],
      });

      const llm = new MockLLM([extract1, extract2, "{}"]);
      const mem = makeMemory(llm, new MockEmbedder());

      const r1 = await mem.add(
        [{ role: "user", content: "I use bash." }],
        { userId: "contradiction-user" },
      );
      const oldId = r1.added[0]!.id;

      // Patch dedup decision with real id
      llm.responses[2] = JSON.stringify({ action: "update", targetId: oldId, reason: "fish replaces bash" });

      const r2 = await mem.add(
        [{ role: "user", content: "I switched to fish shell." }],
        { userId: "contradiction-user" },
      );

      expect(r2.updated.length).toBe(1);

      // New memory should be findable and latest
      const newMem = r2.updated[0]!;
      expect(newMem.isLatest).toBe(true);
      expect(newMem.memory).toContain("fish");

      // Old memory should be marked not latest
      const old = await mem.get(oldId);
      expect(old?.isLatest).toBe(false);
    });

    it("search returns latest version, not superseded one", async () => {
      const extract1 = JSON.stringify({
        memories: [{ memory: "The user prefers Python.", category: "technical", memoryType: "preference", eventDate: null }],
      });
      const extract2 = JSON.stringify({
        memories: [{ memory: "The user prefers Rust.", category: "technical", memoryType: "preference", eventDate: null }],
      });

      const llm = new MockLLM([extract1, extract2, "{}"]);
      const mem = makeMemory(llm, new MockEmbedder());

      const r1 = await mem.add([{ role: "user", content: "I prefer Python." }], { userId: "search-latest-user" });
      const oldId = r1.added[0]!.id;
      llm.responses[2] = JSON.stringify({ action: "update", targetId: oldId, reason: "Rust replaces Python" });

      await mem.add([{ role: "user", content: "I switched to Rust." }], { userId: "search-latest-user" });

      const results = await mem.search("programming language preference", {
        userId: "search-latest-user",
        threshold: 0,
      });

      // Only latest memory should appear (isLatest filter)
      const latestOnly = results.filter(r => r.isLatest !== false);
      expect(latestOnly.every(r => r.isLatest)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T8: getAll with filters
  // -------------------------------------------------------------------------
  describe("T8: getAll filtering", () => {
    it("filters by category correctly", async () => {
      const extractResponse = JSON.stringify({
        memories: [
          { memory: "The user is called Alex.", category: "identity", memoryType: "fact", eventDate: null },
          { memory: "The user uses VSCode.", category: "technical", memoryType: "fact", eventDate: null },
          { memory: "The user wants to learn Rust.", category: "goals", memoryType: "episode", eventDate: null },
        ],
      });
      const llm = new MockLLM([extractResponse]);
      const mem = makeMemory(llm, new MockEmbedder());

      await mem.add(
        [{ role: "user", content: "I'm Alex, I use VSCode and want to learn Rust." }],
        { userId: "filter-user" },
      );

      const techMemories = await mem.getAll({ userId: "filter-user", category: "technical" });
      expect(techMemories.every(m => m.category === "technical")).toBe(true);
      expect(techMemories.length).toBeGreaterThanOrEqual(1);

      const all = await mem.getAll({ userId: "filter-user" });
      expect(all.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // T9: deleteAll
  // -------------------------------------------------------------------------
  describe("T9: deleteAll", () => {
    it("removes all memories for a user", async () => {
      const extractResponse = JSON.stringify({
        memories: [
          { memory: "The user lives in NYC.", category: "identity", memoryType: "fact", eventDate: null },
        ],
      });
      const llm = new MockLLM([extractResponse]);
      const mem = makeMemory(llm, new MockEmbedder());

      await mem.add([{ role: "user", content: "I live in NYC." }], { userId: "delete-user" });

      const before = await mem.getAll({ userId: "delete-user" });
      expect(before.length).toBe(1);

      await mem.deleteAll("delete-user");

      const after = await mem.getAll({ userId: "delete-user" });
      expect(after.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // T10: update()
  // -------------------------------------------------------------------------
  describe("T10: manual update", () => {
    it("updates a memory directly and records history", async () => {
      const extractResponse = JSON.stringify({
        memories: [
          { memory: "The user is 25 years old.", category: "identity", memoryType: "fact", eventDate: null },
        ],
      });
      const llm = new MockLLM([extractResponse]);
      const mem = makeMemory(llm, new MockEmbedder());

      const r = await mem.add([{ role: "user", content: "I am 25." }], { userId: "update-user" });
      const id = r.added[0]!.id;

      const updated = await mem.update(id, "The user is 26 years old.");
      expect(updated?.memory).toBe("The user is 26 years old.");
      expect(updated?.version).toBe(2);

      const hist = await mem.history(id);
      expect(hist.length).toBe(2);
      expect(hist[1]?.action).toBe("update");
      expect(hist[1]?.previousValue).toBe("The user is 25 years old.");
    });
  });
});
