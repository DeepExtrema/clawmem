import type { Embedder, EmbedderConfig } from "../interfaces/index.js";

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

  constructor(config: EmbedderConfig) {
    this.baseURL = config.baseURL.replace(/\/$/, "");
    this.apiKey = config.apiKey ?? "local";
    this.model = config.model ?? "text-embedding-ada-002";
    this.dimension = config.dimension ?? 768;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    const first = results[0];
    if (!first) throw new Error("Embedder returned no results");
    return first;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
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
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedder request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
