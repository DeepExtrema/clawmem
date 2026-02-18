import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import type { LLM, LLMMessage, Embedder } from "../src/interfaces/index.js";
import { hashContent } from "../src/utils/index.js";
import { SqliteVecStore } from "../src/backends/sqlite-vec.js";
import { SqliteHistoryStore } from "../src/backends/sqlite-history.js";
import { Memory } from "../src/memory.js";

export class MockLLM implements LLM {
  public responses: string[];
  public idx = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async complete(
    _messages: LLMMessage[],
    _opts?: { json?: boolean },
  ): Promise<string> {
    const r = this.responses[this.idx % this.responses.length];
    this.idx++;
    return r ?? "{}";
  }
}

export class MockEmbedder implements Embedder {
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
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/** Creates a Memory instance with in-memory stores and mock LLM/embedder */
export function makeMemory(
  llm: LLM,
  embedder: Embedder,
): { memory: Memory; dataDir: string } {
  const vectorStore = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
  const historyStore = new SqliteHistoryStore({ dbPath: ":memory:" });
  const dataDir = join(tmpdir(), `clawmem-test-${randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });
  const memory = new Memory({
    dataDir,
    llm: { baseURL: "" },
    embedder: { baseURL: "" },
    enableGraph: false,
    llmInstance: llm,
    embedderInstance: embedder,
    vectorStore,
    historyStore,
  });
  return { memory, dataDir };
}
