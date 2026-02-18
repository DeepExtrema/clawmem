/**
 * LanceDB vector store backend (scaffold).
 *
 * This is a community-contribution skeleton implementing the VectorStore
 * interface using LanceDB (https://lancedb.github.io/lancedb/).
 *
 * To complete this backend:
 *   1. `npm install @lancedb/lancedb`
 *   2. Implement each TODO below
 *   3. Add tests in tests/lancedb.test.ts
 *
 * LanceDB advantages over sqlite-vec:
 *   - Native ANN with IVF-PQ indexing
 *   - Hybrid search (vector + FTS) built-in
 *   - Disk-based with memory-mapped I/O
 *   - No native compilation needed (pure Rust/WASM)
 */

import type {
  VectorStore,
  VectorStoreResult,
} from "../interfaces/index.js";

export interface LanceDBConfig {
  /** Path to the LanceDB database directory */
  dbPath: string;
  /** Embedding dimension */
  dimension?: number;
  /** Table name (default: "memories") */
  tableName?: string;
}

export class LanceDBStore implements VectorStore {
  private readonly config: LanceDBConfig;
  // private db: unknown; // TODO: lancedb.Connection
  // private table: unknown; // TODO: lancedb.Table

  constructor(config: LanceDBConfig) {
    this.config = { tableName: "memories", ...config };
    // TODO: Initialize LanceDB connection
    //   import * as lancedb from "@lancedb/lancedb";
    //   this.db = await lancedb.connect(config.dbPath);
    //   this.table = await this.db.openTable(this.config.tableName);
    throw new Error(
      "LanceDBStore is a scaffold — install @lancedb/lancedb and implement the TODOs",
    );
  }

  async insert(
    _vectors: number[][],
    _ids: string[],
    _payloads: Record<string, unknown>[],
  ): Promise<void> {
    // TODO: Convert to LanceDB row format and add to table
    //   const rows = ids.map((id, i) => ({
    //     id,
    //     vector: vectors[i],
    //     ...payloads[i],
    //   }));
    //   await this.table.add(rows);
    throw new Error("Not implemented");
  }

  async search(
    _query: number[],
    _limit: number,
    _filters?: Record<string, unknown>,
  ): Promise<VectorStoreResult[]> {
    // TODO: Vector search with optional filter
    //   let q = this.table.vectorSearch(query).limit(limit);
    //   if (filters?.user_id) q = q.where(`user_id = '${filters.user_id}'`);
    //   if (filters?.isLatest) q = q.where("is_latest = true");
    //   const results = await q.toArray();
    //   return results.map(r => ({ id: r.id, score: 1 - r._distance, payload: r }));
    throw new Error("Not implemented");
  }

  async keywordSearch(
    _query: string,
    _limit: number,
    _filters?: Record<string, unknown>,
  ): Promise<VectorStoreResult[]> {
    // TODO: LanceDB FTS search
    //   const results = await this.table
    //     .search(query, "fts")
    //     .limit(limit)
    //     .toArray();
    throw new Error("Not implemented");
  }

  async delete(_id: string): Promise<void> {
    // TODO: await this.table.delete(`id = '${id}'`);
    throw new Error("Not implemented");
  }

  async get(_id: string): Promise<VectorStoreResult | null> {
    // TODO: Query by ID, return first result or null
    throw new Error("Not implemented");
  }

  async list(
    _filters?: Record<string, unknown>,
    _limit?: number,
    _offset?: number,
  ): Promise<[VectorStoreResult[], number]> {
    // TODO: List with filters, return [results, totalCount]
    throw new Error("Not implemented");
  }

  async update(
    _id: string,
    _vector: number[],
    _payload: Record<string, unknown>,
  ): Promise<void> {
    // TODO: Update vector + payload for existing row
    throw new Error("Not implemented");
  }

  async updatePayload(
    _id: string,
    _payload: Record<string, unknown>,
  ): Promise<void> {
    // TODO: Update payload fields only (merge with existing)
    throw new Error("Not implemented");
  }

  async findByHash(
    _hash: string,
    _userId: string,
  ): Promise<VectorStoreResult | null> {
    // TODO: Query by hash + user_id, return first or null
    throw new Error("Not implemented");
  }

  async deleteAll(_filters?: Record<string, unknown>): Promise<void> {
    // TODO: Delete all matching rows
    //   let where = "1=1";
    //   if (filters?.user_id) where = `user_id = '${filters.user_id}'`;
    //   await this.table.delete(where);
    throw new Error("Not implemented");
  }
}
