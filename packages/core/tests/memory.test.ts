import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Memory } from "../src/memory.js";
import type { ClawMemConfig } from "../src/memory.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Test config — uses real local LLM if available, stubs otherwise
// ---------------------------------------------------------------------------

const LLM_BASE_URL = process.env["CLAWMEM_LLM_URL"] ?? "http://127.0.0.1:8080/v1";
const EMBED_BASE_URL = process.env["CLAWMEM_EMBED_URL"] ?? "http://127.0.0.1:8082/v1";
const RUN_INTEGRATION = process.env["CLAWMEM_INTEGRATION"] === "1";

/**
 * Creates a Memory instance backed by in-memory SQLite and mock LLM/embedder.
 * Used for unit tests that don't require a real LLM.
 */
function createTestMemory(dataDir: string, overrides?: Partial<ClawMemConfig>): Memory {
  return new Memory({
    dataDir,
    llm: { baseURL: LLM_BASE_URL, model: "test" },
    embedder: { baseURL: EMBED_BASE_URL, model: "test", dimension: 4 },
    enableGraph: false, // Disable graph for unit tests
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Mock backends for unit tests (no real LLM needed)
// ---------------------------------------------------------------------------

import type { LLM, LLMMessage, Embedder, VectorStore, VectorStoreResult } from "../src/interfaces/index.js";
import { hashContent } from "../src/utils/index.js";
import { SqliteVecStore } from "../src/backends/sqlite-vec.js";
import { SqliteHistoryStore } from "../src/backends/sqlite-history.js";

class MockLLM implements LLM {
  public responses: string[];
  public idx = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async complete(_messages: LLMMessage[], _opts?: { json?: boolean }): Promise<string> {
    const r = this.responses[this.idx % this.responses.length];
    this.idx++;
    return r ?? "{}";
  }
}

class MockEmbedder implements Embedder {
  readonly dimension = 4;

  async embed(text: string): Promise<number[]> {
    // Deterministic fake embedding from hash
    const h = hashContent(text);
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
      parseInt(h.slice(6, 8), 16) / 255,
    ];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Memory — Core Tests", () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = join(tmpdir(), `clawmem-test-${randomUUID()}`);
    mkdirSync(dataDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // T1: Extraction quality
  // -------------------------------------------------------------------------
  describe("T1: Extraction quality", () => {
    it("extracts memories from conversation using mock LLM", async () => {
      const mockResponse = JSON.stringify({
        memories: [
          { memory: "The user prefers TypeScript over Python.", category: "technical", memoryType: "preference", eventDate: null },
          { memory: "The user uses an AMD GPU (RX 6750 XT).", category: "infrastructure", memoryType: "fact", eventDate: null },
          { memory: "The user runs Hyprland on CachyOS.", category: "technical", memoryType: "fact", eventDate: null },
        ],
      });

      // Skip (add) decision for all
      const skipResponse = JSON.stringify({ action: "add", targetId: null, reason: "No similar" });
      const entityResponse = JSON.stringify({ entities: [], relations: [] });

      const llm = new MockLLM([
        mockResponse,
        skipResponse, skipResponse, skipResponse,
        entityResponse, entityResponse, entityResponse,
      ]);
      const embedder = new MockEmbedder();
      const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
      const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });

      const mem = new Memory({
        dataDir,
        llm: { baseURL: "" },
        embedder: { baseURL: "" },
        enableGraph: false,
        llmInstance: llm,
        embedderInstance: embedder,
        vectorStore,
        historyStore,
      });

      const result = await mem.add(
        [
          { role: "user", content: "I prefer TypeScript. I use an AMD GPU and run Hyprland." },
        ],
        { userId: "user1" },
      );

      expect(result.added.length).toBe(3);
      expect(result.deduplicated).toBe(0);
      expect(result.added[0]?.memory).toContain("TypeScript");
    });

    it("returns empty result when LLM finds nothing worth remembering", async () => {
      const llm = new MockLLM([JSON.stringify({ memories: [] })]);
      const embedder = new MockEmbedder();
      const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
      const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });

      const mem = new Memory({
        dataDir,
        llm: { baseURL: "" },
        embedder: { baseURL: "" },
        enableGraph: false,
        llmInstance: llm,
        embedderInstance: embedder,
        vectorStore,
        historyStore,
      });

      const result = await mem.add(
        [{ role: "user", content: "Hello, how are you?" }],
        { userId: "user1" },
      );

      expect(result.added.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // T2: Search precision
  // -------------------------------------------------------------------------
  describe("T2: Search precision", () => {
    it("finds stored memories by semantic search", async () => {
      const addResponse = JSON.stringify({
        memories: [
          { memory: "The user uses fish shell.", category: "technical", memoryType: "fact", eventDate: null },
        ],
      });
      const skipResponse = JSON.stringify({ action: "add", targetId: null, reason: "No similar" });

      const llm = new MockLLM([addResponse, skipResponse]);
      const embedder = new MockEmbedder();
      const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
      const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });

      const mem = new Memory({
        dataDir,
        llm: { baseURL: "" },
        embedder: { baseURL: "" },
        enableGraph: false,
        llmInstance: llm,
        embedderInstance: embedder,
        vectorStore,
        historyStore,
      });

      await mem.add(
        [{ role: "user", content: "I use fish shell daily." }],
        { userId: "user2" },
      );

      const results = await mem.search("shell", { userId: "user2", threshold: 0 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.memory).toContain("fish shell");
    });
  });

  // -------------------------------------------------------------------------
  // T3: Deduplication
  // -------------------------------------------------------------------------
  describe("T3: Deduplication", () => {
    it("deduplicates exact duplicate memories", async () => {
      // Hash-based dedup: hash check short-circuits before calling LLM for dedup
      // Only extraction calls consume LLM responses (2 total — one per add)
      const addResponse = JSON.stringify({
        memories: [
          { memory: "The user prefers dark mode.", category: "preferences", memoryType: "preference", eventDate: null },
        ],
      });

      // Both adds return same extraction response; dedup finds hash match and skips LLM
      const llm = new MockLLM([addResponse, addResponse]);
      const embedder = new MockEmbedder();
      const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
      const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });

      const mem = new Memory({
        dataDir,
        llm: { baseURL: "" },
        embedder: { baseURL: "" },
        enableGraph: false,
        llmInstance: llm,
        embedderInstance: embedder,
        vectorStore,
        historyStore,
      });

      const r1 = await mem.add(
        [{ role: "user", content: "I always use dark mode." }],
        { userId: "user3" },
      );
      expect(r1.added.length).toBe(1);

      const r2 = await mem.add(
        [{ role: "user", content: "I always use dark mode." }],
        { userId: "user3" },
      );
      expect(r2.added.length).toBe(0);
      expect(r2.deduplicated).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // T4: Contradiction / UPDATE
  // -------------------------------------------------------------------------
  describe("T4: Contradiction resolution", () => {
    it("marks old memory as superseded when new contradicts it", async () => {
      const addResponse1 = JSON.stringify({
        memories: [
          { memory: "The user's favorite language is Python.", category: "technical", memoryType: "preference", eventDate: null },
        ],
      });
      // responses[0] = extraction for first add
      // responses[1] = extraction for second add
      // responses[2] = dedup decision (patched after first add to include real oldId)
      const llm = new MockLLM([
        addResponse1,
        JSON.stringify({
          memories: [
            { memory: "The user's favorite language is Rust.", category: "technical", memoryType: "preference", eventDate: null },
          ],
        }),
        // placeholder — will be patched with real oldId after first add
        "{}",
      ]);

      const embedder = new MockEmbedder();
      const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
      const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });

      const mem = new Memory({
        dataDir,
        llm: { baseURL: "" },
        embedder: { baseURL: "" },
        enableGraph: false,
        llmInstance: llm,
        embedderInstance: embedder,
        vectorStore,
        historyStore,
      });

      const r1 = await mem.add(
        [{ role: "user", content: "My favorite language is Python." }],
        { userId: "user4" },
      );
      expect(r1.added.length).toBe(1);
      const oldId = r1.added[0]!.id;

      // Patch the dedup decision with the real oldId (used at idx=2)
      llm.responses[2] = JSON.stringify({
        action: "update",
        targetId: oldId,
        reason: "Rust supersedes Python",
      });

      const r2 = await mem.add(
        [{ role: "user", content: "I switched to Rust as my favorite language." }],
        { userId: "user4" },
      );
      expect(r2.updated.length).toBe(1);

      // Old memory should now have isLatest=false
      const old = await mem.get(oldId);
      expect(old?.isLatest).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // T5: getAll + profile
  // -------------------------------------------------------------------------
  describe("T5: getAll and profile", () => {
    it("returns all memories for a user", async () => {
      const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
      const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });

      const addResponse = JSON.stringify({
        memories: [
          { memory: "The user is a software engineer.", category: "identity", memoryType: "fact", eventDate: null },
          { memory: "The user prefers remote work.", category: "preferences", memoryType: "preference", eventDate: null },
        ],
      });
      const addDecision = JSON.stringify({ action: "add", targetId: null, reason: "New" });

      const llm = new MockLLM([addResponse, addDecision, addDecision]);
      const embedder = new MockEmbedder();

      const mem = new Memory({
        dataDir,
        llm: { baseURL: "" },
        embedder: { baseURL: "" },
        enableGraph: false,
        llmInstance: llm,
        embedderInstance: embedder,
        vectorStore,
        historyStore,
      });

      await mem.add(
        [{ role: "user", content: "I'm a software engineer who works remotely." }],
        { userId: "user5" },
      );

      const all = await mem.getAll({ userId: "user5" });
      expect(all.length).toBe(2);

      const profile = await mem.profile("user5");
      expect(profile.static.identity.length).toBe(1);
      expect(profile.static.preferences.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // T6: delete and history
  // -------------------------------------------------------------------------
  describe("T6: delete and history", () => {
    it("records history entries and delete works", async () => {
      const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
      const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });

      const addResponse = JSON.stringify({
        memories: [
          { memory: "The user lives in Berlin.", category: "identity", memoryType: "fact", eventDate: null },
        ],
      });
      const addDecision = JSON.stringify({ action: "add", targetId: null, reason: "New" });

      const mem = new Memory({
        dataDir,
        llm: { baseURL: "" },
        embedder: { baseURL: "" },
        enableGraph: false,
        llmInstance: new MockLLM([addResponse, addDecision]),
        embedderInstance: new MockEmbedder(),
        vectorStore,
        historyStore,
      });

      const r = await mem.add(
        [{ role: "user", content: "I live in Berlin." }],
        { userId: "user6" },
      );

      const id = r.added[0]!.id;
      const hist = await mem.history(id);
      expect(hist.length).toBe(1);
      expect(hist[0]?.action).toBe("add");

      await mem.delete(id);
      const deleted = await mem.get(id);
      expect(deleted).toBeNull();

      const hist2 = await mem.history(id);
      expect(hist2.length).toBe(2);
      expect(hist2[1]?.action).toBe("delete");
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests (only run with CLAWMEM_INTEGRATION=1)
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_INTEGRATION)("Integration: Real LLM + Embedder", () => {
  let dataDir: string;
  let mem: Memory;

  beforeAll(() => {
    dataDir = join(tmpdir(), `clawmem-integration-${randomUUID()}`);
    mkdirSync(dataDir, { recursive: true });
    mem = new Memory({
      dataDir,
      llm: { baseURL: LLM_BASE_URL, model: "deepseek-r1" },
      embedder: { baseURL: EMBED_BASE_URL, model: "nomic-embed-text", dimension: 768 },
      enableGraph: false,
    });
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("T1-integration: extracts at least 3 facts from a real conversation", async () => {
    const result = await mem.add(
      [
        { role: "user", content: "I'm a TypeScript developer running Hyprland on CachyOS. I have an AMD RX 6750 XT GPU and an Intel i7 processor with 32GB RAM. My AI agent is called OpenClaw." },
        { role: "assistant", content: "Got it! You've got a solid local AI setup." },
      ],
      { userId: "integration-user" },
    );

    expect(result.added.length).toBeGreaterThanOrEqual(3);
    console.log("Extracted memories:", result.added.map((m) => m.memory));
  }, 60_000);

  it("T2-integration: search finds relevant memories", async () => {
    const results = await mem.search("GPU hardware", {
      userId: "integration-user",
      threshold: 0.3,
    });

    expect(results.length).toBeGreaterThan(0);
    console.log("Search results:", results.map((m) => `${m.score?.toFixed(2)} ${m.memory}`));
  }, 30_000);
});
