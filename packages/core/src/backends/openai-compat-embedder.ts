import type { Embedder, EmbedderConfig } from "../interfaces/index.js";
import { EmbedderError } from "../errors.js";

const DEFAULT_EMBEDDER_TIMEOUT_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_EMBEDDER_CONCURRENCY = 2;
const MAX_EMBEDDER_CONCURRENCY = 8;

/**
 * OpenAI-compatible embedder adapter.
 * Works with any endpoint that implements the /v1/embeddings API:
 *   - llama.cpp server (--embedding flag)
 *   - Ollama
 *   - LM Studio
 *   - OpenAI
 *   - nomic-embed-text, etc.
 */
export class OpenAICompatEmbedder implements Embedder {
  readonly dimension: number;
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly concurrency: number;

  constructor(config: EmbedderConfig) {
    this.baseURL = config.baseURL.replace(/\/$/, "");
    this.apiKey = config.apiKey ?? "local";
    this.model = config.model ?? "text-embedding-ada-002";
    this.dimension = config.dimension ?? 768;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_EMBEDDER_TIMEOUT_MS;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.concurrency = Math.min(
      Math.max(config.concurrency ?? DEFAULT_EMBEDDER_CONCURRENCY, 1),
      MAX_EMBEDDER_CONCURRENCY,
    );
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    const first = results[0];
    if (!first) throw new EmbedderError("Embedder returned no results");
    return first;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // #47: Chunk into batchSize groups
    const chunks: string[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      chunks.push(texts.slice(i, i + this.batchSize));
    }
    if (chunks.length === 0) return [];

    // #performance-3A: bounded concurrency with deterministic output order
    const outputs: number[][][] = new Array(chunks.length);
    let nextIndex = 0;
    const workerCount = Math.min(this.concurrency, chunks.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const idx = nextIndex++;
          if (idx >= chunks.length) return;
          outputs[idx] = await this.fetchEmbeddings(chunks[idx]!);
        }
      }),
    );

    const allResults: number[][] = [];
    for (const chunkResult of outputs) {
      if (chunkResult) {
        allResults.push(...chunkResult);
      }
    }
    return allResults;
  }

  private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
    // #45: AbortController timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseURL}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new EmbedderError(`Embedder request failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      return data.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new EmbedderError(`Embedder request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
