import Database from "better-sqlite3";
import type {
  VectorStore,
  VectorStoreResult,
} from "../interfaces/index.js";
import { EmbedderError } from "../errors.js";
import type { Logger } from "../memory.js";

/**
 * SQLite-based vector store using sqlite-vec extension.
 *
 * Falls back to a pure-SQLite cosine similarity implementation if sqlite-vec
 * native extension is not available (e.g., in test environments).
 *
 * Schema:
 *   - memories: stores payload (JSON) and the full-text for FTS
 *   - memories_vec: virtual table (sqlite-vec) for ANN search
 *   - memories_fts: FTS5 virtual table for keyword search
 */

export interface SqliteVecConfig {
  /** Path to the SQLite database file, or ":memory:" */
  dbPath: string;
  /** Embedding dimension (must match your embedder) */
  dimension?: number;
  /** Optional logger (uses console.warn if not provided) */
  logger?: Logger;
}

export class SqliteVecStore implements VectorStore {
  private db: Database.Database;
  private readonly dimension: number;
  private hasVecExtension = false;
  private readonly log: Logger | undefined;

  constructor(config: SqliteVecConfig) {
    this.dimension = config.dimension ?? 768;
    this.log = config.logger;
    this.db = new Database(config.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    const shouldAttemptVecLoad =
      process.env["CLAWMEM_DISABLE_SQLITE_VEC"] !== "1" &&
      process.env["VITEST"] !== "true" &&
      process.env["NODE_ENV"] !== "test";

    // Try to load sqlite-vec extension
    if (shouldAttemptVecLoad) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sqliteVec = require("sqlite-vec");
        sqliteVec.load(this.db);
        this.hasVecExtension = true;
      } catch {
        // sqlite-vec not available — O(n) linear fallback
        const msg = "[clawmem] sqlite-vec extension not available — falling back to O(n) linear cosine similarity. Install sqlite-vec for ANN search.";
        if (this.log) {
          this.log.warn(msg);
        } else {
          console.warn(msg);
        }
      }
    }

    // Main memories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        content TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS memories_user_id ON memories(user_id);
      CREATE INDEX IF NOT EXISTS memories_hash ON memories(
        json_extract(payload, '$.hash')
      );
    `);

    // FTS5 for keyword search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(id UNINDEXED, content, user_id UNINDEXED, tokenize='porter unicode61');
    `);

    // Vector storage: either sqlite-vec virtual table or a blob column
    if (this.hasVecExtension) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec
        USING vec0(
          id TEXT PRIMARY KEY,
          embedding FLOAT[${this.dimension}]
        );
      `);
    } else {
      // Fallback: store vectors as blobs, do linear scan cosine similarity
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories_vec (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL
        );
      `);
    }
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, unknown>[],
  ): Promise<void> {
    // #38: Validate embedding dimensions
    for (let i = 0; i < vectors.length; i++) {
      if (vectors[i]!.length !== this.dimension) {
        throw new EmbedderError(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${vectors[i]!.length} (index ${i})`,
        );
      }
    }
    const insertMemory = this.db.prepare(`
      INSERT INTO memories (id, payload, content, user_id)
      VALUES (@id, @payload, @content, @userId)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        content = excluded.content,
        updated_at = datetime('now')
    `);

    const insertFts = this.db.prepare(`
      INSERT INTO memories_fts (id, content, user_id)
      VALUES (@id, @content, @userId)
    `);

    const deleteFts = this.db.prepare(
      `DELETE FROM memories_fts WHERE id = @id`,
    );

    const deleteVec = this.db.prepare(`DELETE FROM memories_vec WHERE id = ?`);

    const insertVec = this.hasVecExtension
      ? this.db.prepare(
          `INSERT INTO memories_vec (id, embedding) VALUES (?, vec_f32(?))`,
        )
      : this.db.prepare(
          `INSERT INTO memories_vec (id, embedding) VALUES (?, ?)`,
        );

    const tx = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const vector = vectors[i]!;
        const payload = payloads[i]!;
        const content = String(payload["memory"] ?? "");
        const userId = String(payload["userId"] ?? "");

        insertMemory.run({ id, payload: JSON.stringify(payload), content, userId });
        deleteFts.run({ id });
        insertFts.run({ id, content, userId });

        const vecBuffer = Buffer.from(new Float32Array(vector).buffer);
        deleteVec.run(id);
        insertVec.run(id, vecBuffer);
      }
    });

    tx();
  }

  async search(
    query: number[],
    limit: number,
    filters?: Record<string, unknown>,
  ): Promise<VectorStoreResult[]> {
    if (this.hasVecExtension) {
      return this.searchVec(query, limit, filters);
    }
    return this.searchFallback(query, limit, filters);
  }

  private buildSearchConditions(
    filters: Record<string, unknown> | undefined,
    tableAlias: string,
  ): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const userId = filters?.["userId"] as string | undefined;
    const isLatest = filters?.["isLatest"] as boolean | undefined;
    const category = filters?.["category"] as string | undefined;
    const memoryType = filters?.["memoryType"] as string | undefined;
    const fromDate = filters?.["fromDate"] as string | undefined;
    const toDate = filters?.["toDate"] as string | undefined;

    if (userId) {
      conditions.push(`${tableAlias}.user_id = ?`);
      params.push(userId);
    }
    if (isLatest !== undefined) {
      conditions.push(`json_extract(${tableAlias}.payload, '$.isLatest') = ?`);
      params.push(isLatest ? 1 : 0);
    }
    if (category) {
      conditions.push(`json_extract(${tableAlias}.payload, '$.category') = ?`);
      params.push(category);
    }
    if (memoryType) {
      conditions.push(`json_extract(${tableAlias}.payload, '$.memoryType') = ?`);
      params.push(memoryType);
    }
    if (fromDate) {
      conditions.push(`COALESCE(json_extract(${tableAlias}.payload, '$.eventDate'), json_extract(${tableAlias}.payload, '$.createdAt')) >= ?`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`COALESCE(json_extract(${tableAlias}.payload, '$.eventDate'), json_extract(${tableAlias}.payload, '$.createdAt')) <= ?`);
      params.push(toDate);
    }

    return { conditions, params };
  }

  private searchVec(
    query: number[],
    limit: number,
    filters?: Record<string, unknown>,
  ): VectorStoreResult[] {
    const queryBuffer = Buffer.from(new Float32Array(query).buffer);
    const { conditions, params: filterParams } = this.buildSearchConditions(
      filters,
      "m",
    );

    // vec0 does not allow both "k = ?" and "LIMIT ?" in the same query.
    // Use k = ? to control result count. Over-fetch when filters are present.
    const k = conditions.length > 0 ? limit * 4 : limit;

    let sql = `
      SELECT m.id, m.payload, distance
      FROM memories_vec v
      JOIN memories m ON v.id = m.id
      WHERE v.embedding MATCH ? AND k = ?
    `;
    const params: unknown[] = [queryBuffer, k, ...filterParams];

    if (conditions.length > 0) {
      sql += ` AND ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY distance`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      payload: string;
      distance: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      score: 1 - row.distance, // convert distance to similarity
    }));
  }

  private searchFallback(
    query: number[],
    limit: number,
    filters?: Record<string, unknown>,
  ): VectorStoreResult[] {
    if (limit <= 0) return [];

    let sql = `SELECT m.id, m.payload, v.embedding FROM memories_vec v JOIN memories m ON v.id = m.id`;
    const { conditions, params } = this.buildSearchConditions(filters, "m");
    const FALLBACK_LIMIT = 50000;

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += ` LIMIT ?`;
    params.push(FALLBACK_LIMIT);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      payload: string;
      embedding: Buffer;
    }>;

    if (rows.length >= FALLBACK_LIMIT && this.log) {
      this.log.warn(`searchFallback: result set truncated at ${FALLBACK_LIMIT} rows — consider installing sqlite-vec`);
    }

    const top: Array<{
      id: string;
      payloadJson: string;
      score: number;
    }> = [];
    for (const row of rows) {
      const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const score = this.cosineSimilarityFloat(query, vec);
      const candidate = {
        id: row.id,
        payloadJson: row.payload,
        score,
      };
      let inserted = false;
      for (let i = 0; i < top.length; i++) {
        if (score > top[i]!.score) {
          top.splice(i, 0, candidate);
          inserted = true;
          break;
        }
      }
      if (!inserted && top.length < limit) {
        top.push(candidate);
      }
      if (top.length > limit) {
        top.pop();
      }
    }

    return top.map((row) => ({
      id: row.id,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      score: row.score,
    }));
  }

  private cosineSimilarityFloat(query: number[], embedding: Float32Array): number {
    const len = Math.min(query.length, embedding.length);
    if (len === 0) return 0;
    let dot = 0;
    let qNorm = 0;
    let eNorm = 0;
    for (let i = 0; i < len; i++) {
      const q = query[i]!;
      const e = embedding[i]!;
      dot += q * e;
      qNorm += q * q;
      eNorm += e * e;
    }
    if (qNorm === 0 || eNorm === 0) return 0;
    return dot / (Math.sqrt(qNorm) * Math.sqrt(eNorm));
  }

  async keywordSearch(
    query: string,
    limit: number,
    filters?: Record<string, unknown>,
  ): Promise<VectorStoreResult[]> {
    // #46: Quote FTS5 tokens to prevent syntax injection
    const safeQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, '""')}"`)
      .join(" ");

    if (!safeQuery) return [];

    let sql = `
      SELECT f.id, m.payload, bm25(memories_fts) AS score
      FROM memories_fts f
      JOIN memories m ON f.id = m.id
      WHERE memories_fts MATCH ?
    `;
    const params: unknown[] = [safeQuery];
    const { conditions, params: filterParams } = this.buildSearchConditions(
      filters,
      "m",
    );
    if (conditions.length > 0) {
      sql += ` AND ${conditions.join(" AND ")}`;
      params.push(...filterParams);
    }

    sql += ` ORDER BY score LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      payload: string;
      score: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      score: Math.abs(row.score), // bm25 returns negative values
    }));
  }

  async delete(id: string): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
      this.db.prepare(`DELETE FROM memories_fts WHERE id = ?`).run(id);
      this.db.prepare(`DELETE FROM memories_vec WHERE id = ?`).run(id);
    })();
  }

  async get(id: string): Promise<VectorStoreResult | null> {
    const row = this.db
      .prepare(`SELECT id, payload FROM memories WHERE id = ?`)
      .get(id) as { id: string; payload: string } | undefined;

    if (!row) return null;
    return {
      id: row.id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      score: 1,
    };
  }

  async list(
    filters?: Record<string, unknown>,
    limit = 100,
    offset = 0,
  ): Promise<[VectorStoreResult[], number]> {
    // #63: Single query with window function instead of separate count query
    // #23: Push isLatest filter to SQL
    const { conditions, params } = this.buildSearchConditions(filters, "memories");

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT id, payload, COUNT(*) OVER() as total FROM memories${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      payload: string;
      total: number;
    }>;

    const total = rows.length > 0 ? rows[0]!.total : 0;

    return [
      rows.map((row) => ({
        id: row.id,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
        score: 1,
      })),
      total,
    ];
  }

  async update(
    id: string,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    const content = String(payload["memory"] ?? "");
    const userId = String(payload["userId"] ?? "");
    const vecBuffer = Buffer.from(new Float32Array(vector).buffer);

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE memories SET payload = ?, content = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(JSON.stringify(payload), content, id);

      // FTS5 doesn't support UPDATE — delete + re-insert
      this.db.prepare(`DELETE FROM memories_fts WHERE id = ?`).run(id);
      this.db
        .prepare(
          `INSERT INTO memories_fts (id, content, user_id) VALUES (?, ?, ?)`,
        )
        .run(id, content, userId);

      if (this.hasVecExtension) {
        this.db
          .prepare(
            `UPDATE memories_vec SET embedding = vec_f32(?) WHERE id = ?`,
          )
          .run(vecBuffer, id);
      } else {
        this.db
          .prepare(`UPDATE memories_vec SET embedding = ? WHERE id = ?`)
          .run(vecBuffer, id);
      }
    })();
  }

  async updatePayload(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const content = String(payload["memory"] ?? "");
    const userId = String(payload["userId"] ?? "");

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE memories SET payload = ?, content = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(JSON.stringify(payload), content, id);

      // Rebuild FTS
      this.db.prepare(`DELETE FROM memories_fts WHERE id = ?`).run(id);
      this.db
        .prepare(
          `INSERT INTO memories_fts (id, content, user_id) VALUES (?, ?, ?)`,
        )
        .run(id, content, userId);
    })();
  }

  async findByHash(
    hash: string,
    userId: string,
  ): Promise<VectorStoreResult | null> {
    const row = this.db
      .prepare(
        `SELECT id, payload FROM memories WHERE json_extract(payload, '$.hash') = ? AND user_id = ? LIMIT 1`,
      )
      .get(hash, userId) as { id: string; payload: string } | undefined;

    if (!row) return null;
    return {
      id: row.id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      score: 1,
    };
  }

  async deleteAll(filters?: Record<string, unknown>): Promise<void> {
    const userId = filters?.["userId"] as string | undefined;

    if (userId) {
      this.db.transaction(() => {
        this.db
          .prepare(
            `DELETE FROM memories_vec WHERE id IN (SELECT id FROM memories WHERE user_id = ?)`,
          )
          .run(userId);
        this.db
          .prepare(
            `DELETE FROM memories_fts WHERE id IN (SELECT id FROM memories WHERE user_id = ?)`,
          )
          .run(userId);
        this.db
          .prepare(`DELETE FROM memories WHERE user_id = ?`)
          .run(userId);
      })();
    } else {
      this.db.exec(
        `DELETE FROM memories; DELETE FROM memories_fts; DELETE FROM memories_vec;`,
      );
    }
  }

  close(): void {
    this.db.close();
  }
}
