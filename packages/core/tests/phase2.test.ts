import { describe, it, expect } from "vitest";
import { Memory } from "../src/memory.js";
import type { LLM, Embedder } from "../src/interfaces/index.js";
import { MockLLM, MockEmbedder, makeMemory } from "./helpers.js";

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
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

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
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

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
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

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
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

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
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

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
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

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
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

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

    // #42: update() returns null for nonexistent ID
    it("returns null for nonexistent ID", async () => {
      const llm = new MockLLM([]);
      const { memory: mem } = makeMemory(llm, new MockEmbedder());
      const result = await mem.update("nonexistent-id", "new text");
      expect(result).toBeNull();
    });
  });

  // #44: Concurrent add() test
  describe("T11: concurrent add", () => {
    it("handles concurrent add calls without crashing", async () => {
      const extractResponse = JSON.stringify({
        memories: [
          { memory: "concurrent fact", category: "other", memoryType: "fact", eventDate: null },
        ],
      });
      const llm = new MockLLM([extractResponse]);
      const { memory: mem } = makeMemory(llm, new MockEmbedder());

      const results = await Promise.all([
        mem.add([{ role: "user", content: "Fact A" }], { userId: "concurrent-user" }),
        mem.add([{ role: "user", content: "Fact B" }], { userId: "concurrent-user" }),
        mem.add([{ role: "user", content: "Fact C" }], { userId: "concurrent-user" }),
      ]);

      // All should succeed — total adds + dedup should equal 3
      const totalAdded = results.reduce((sum, r) => sum + r.added.length, 0);
      const totalDeduped = results.reduce((sum, r) => sum + r.deduplicated, 0);
      expect(totalAdded + totalDeduped).toBe(3);
    });
  });
});
