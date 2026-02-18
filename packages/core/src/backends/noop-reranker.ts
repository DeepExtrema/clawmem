import type { Reranker, VectorStoreResult } from "../interfaces/index.js";

/**
 * No-op reranker — returns items unchanged (passthrough).
 * Used as the default when no cross-encoder reranker is configured.
 */
export class NoopReranker implements Reranker {
  async rerank(
    _query: string,
    items: VectorStoreResult[],
    topK?: number,
  ): Promise<VectorStoreResult[]> {
    if (topK !== undefined && topK < items.length) {
      return items.slice(0, topK);
    }
    return items;
  }
}
