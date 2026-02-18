import { describe, expect, it } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import { Memory } from "../src/memory.js";
import type {
  Embedder,
  HistoryStore,
  LLM,
  LLMMessage,
  Reranker,
  VectorStore,
  VectorStoreResult,
} from "../src/interfaces/index.js";
import { SqliteHistoryStore } from "../src/backends/sqlite-history.js";

class CountingEmbedder implements Embedder {
  readonly dimension = 4;
  calls = 0;

  async embed(_text: string): Promise<number[]> {
    this.calls++;
    return [1, 0, 0, 0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}

class StubLLM implements LLM {
  async complete(_messages: LLMMessage[], _opts?: { json?: boolean }): Promise<string> {
    return "{}";
  }
}

class ReverseReranker implements Reranker {
  calls = 0;

  async rerank(
    _query: string,
    items: VectorStoreResult[],
  ): Promise<VectorStoreResult[]> {
    this.calls++;
    return [...items].reverse();
  }
}

class StubVectorStore implements VectorStore {
  async insert(): Promise<void> {}

  async search(): Promise<VectorStoreResult[]> {
    return [
      {
        id: "m1",
        payload: {
          memory: "First memory",
          userId: "u1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          isLatest: true,
          version: 1,
          hash: "h1",
        },
        score: 0.95,
      },
      {
        id: "m2",
        payload: {
          memory: "Second memory",
          userId: "u1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          isLatest: true,
          version: 1,
          hash: "h2",
        },
        score: 0.9,
      },
    ];
  }

  async keywordSearch(): Promise<VectorStoreResult[]> {
    return [];
  }

  async delete(): Promise<void> {}

  async get(): Promise<VectorStoreResult | null> {
    return null;
  }

  async list(): Promise<[VectorStoreResult[], number]> {
    return [[], 0];
  }

  async update(): Promise<void> {}

  async updatePayload(): Promise<void> {}

  async findByHash(): Promise<VectorStoreResult | null> {
    return null;
  }

  async deleteAll(): Promise<void> {}
}

describe("Memory search pipeline", () => {
  it("uses reranker and caches query embedding for repeated searches", async () => {
    const dataDir = join(tmpdir(), `clawmem-search-pipeline-${randomUUID()}`);
    mkdirSync(dataDir, { recursive: true });

    const embedder = new CountingEmbedder();
    const reranker = new ReverseReranker();
    const vectorStore = new StubVectorStore();
    const historyStore: HistoryStore = new SqliteHistoryStore({ dbPath: ":memory:" });

    const mem = new Memory({
      dataDir,
      llm: { baseURL: "http://localhost:1/v1" },
      embedder: { baseURL: "http://localhost:2/v1", dimension: 4 },
      enableGraph: false,
      llmInstance: new StubLLM(),
      embedderInstance: embedder,
      vectorStore,
      historyStore,
      reranker,
      queryCacheTtlMs: 60_000,
    });

    try {
      const first = await mem.search("repeatable query", { userId: "u1", threshold: 0 });
      const second = await mem.search("repeatable query", { userId: "u1", threshold: 0 });

      expect(first[0]!.id).toBe("m1");
      expect(second[0]!.id).toBe("m1");
      expect(reranker.calls).toBe(2);
      // one embed for first search; second search should hit cache
      expect(embedder.calls).toBe(1);
    } finally {
      mem.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
