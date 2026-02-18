import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import type {
  GraphStore,
  GraphRelation,
  GraphEntitySummary,
} from "../interfaces/index.js";
import { now } from "../utils/index.js";

export interface KuzuConfig {
  /** Directory path for the Kùzu database */
  dbPath: string;
  /** Buffer pool size in bytes (default 256MB) */
  bufferPoolSize?: number;
}

/**
 * Kùzu embedded graph store.
 * Kùzu is a property graph database like SQLite — fully embedded, no server.
 */
export class KuzuGraphStore implements GraphStore {
  private db: InstanceType<typeof import("kuzu").Database> | null = null;
  private conn: InstanceType<typeof import("kuzu").Connection> | null = null;
  private readonly config: KuzuConfig;

  constructor(config: KuzuConfig) {
    this.config = config;
  }

  private async ensureInit(): Promise<void> {
    if (this.db !== null) return;

    const kuzu = await import("kuzu");
    mkdirSync(this.config.dbPath, { recursive: true });

    this.db = new kuzu.Database(
      this.config.dbPath,
      this.config.bufferPoolSize ?? 256 * 1024 * 1024,
    );
    this.conn = new kuzu.Connection(this.db);

    await this.createSchema();
  }

  private async createSchema(): Promise<void> {
    const conn = this.conn!;

    const queries = [
      // Node tables
      `CREATE NODE TABLE IF NOT EXISTS Entity (
        id STRING,
        name STRING,
        type STRING,
        user_id STRING,
        created_at STRING,
        updated_at STRING,
        PRIMARY KEY (id)
      )`,
      `CREATE NODE TABLE IF NOT EXISTS Memory (
        id STRING,
        content STRING,
        user_id STRING,
        is_latest BOOLEAN,
        version INT32,
        created_at STRING,
        updated_at STRING,
        PRIMARY KEY (id)
      )`,
      // Relationship tables
      `CREATE REL TABLE IF NOT EXISTS RELATES_TO (
        FROM Entity TO Entity,
        relationship STRING,
        confidence FLOAT,
        created_at STRING
      )`,
      `CREATE REL TABLE IF NOT EXISTS UPDATES (
        FROM Memory TO Memory,
        reason STRING,
        created_at STRING
      )`,
      `CREATE REL TABLE IF NOT EXISTS EXTENDS (
        FROM Memory TO Memory,
        created_at STRING
      )`,
      `CREATE REL TABLE IF NOT EXISTS ABOUT (
        FROM Memory TO Entity,
        created_at STRING
      )`,
    ];

    for (const q of queries) {
      await this.query(q);
    }
  }

  private async query(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<unknown[]> {
    await this.ensureInit();
    let result;
    if (params && Object.keys(params).length > 0) {
      const ps = await this.conn!.prepare(cypher);
      result = await this.conn!.execute(ps, params);
    } else {
      result = await this.conn!.query(cypher);
    }
    const table = await result.getAll();
    return table;
  }

  async addEntities(
    entities: Array<{ name: string; type: string; userId: string; metadata?: Record<string, unknown> }>,
    relations: Array<{
      sourceId?: string;
      sourceName: string;
      relationship: string;
      targetId?: string;
      targetName: string;
      confidence?: number;
    }>,
    userId?: string,
  ): Promise<void> {
    await this.ensureInit();
    const ts = now();
    // #50: Use explicit userId parameter, fall back to entities[0]?.userId
    const effectiveUserId = userId ?? entities[0]?.userId ?? "";

    // Upsert entities — use name+userId as logical key
    for (const entity of entities) {
      // Check if entity exists by name + user_id
      const existing = await this.query(
        `MATCH (e:Entity {name: $name, user_id: $userId}) RETURN e.id AS id`,
        { name: entity.name, userId: entity.userId },
      ) as Array<{ id: string }>;

      if (existing.length === 0) {
        await this.query(
          `CREATE (e:Entity {id: $id, name: $name, type: $type, user_id: $userId, created_at: $ts, updated_at: $ts})`,
          { id: randomUUID(), name: entity.name, type: entity.type, userId: entity.userId, ts },
        );
      } else {
        await this.query(
          `MATCH (e:Entity {name: $name, user_id: $userId}) SET e.updated_at = $ts`,
          { name: entity.name, userId: entity.userId, ts },
        );
      }
    }

    // Create relationships
    for (const rel of relations) {
      await this.query(
        `MATCH (src:Entity {name: $srcName, user_id: $userId}), (tgt:Entity {name: $tgtName, user_id: $userId})
         CREATE (src)-[:RELATES_TO {relationship: $rel, confidence: $confidence, created_at: $ts}]->(tgt)`,
        {
          srcName: rel.sourceName,
          tgtName: rel.targetName,
          userId: effectiveUserId,
          rel: rel.relationship,
          confidence: rel.confidence ?? 1.0,
          ts,
        },
      );
    }
  }

  async search(
    query: string,
    userId: string,
    limit = 10,
    offset = 0,
  ): Promise<GraphRelation[]> {
    await this.ensureInit();
    const requested = Math.max(limit + offset, limit);
    const rows = await this.query(
      `MATCH (src:Entity {user_id: $userId})-[r:RELATES_TO]->(tgt:Entity {user_id: $userId})
       RETURN src.id, src.name, r.relationship, tgt.id, tgt.name, r.confidence, r.created_at
       ORDER BY r.created_at DESC LIMIT $limit`,
      { userId, limit: requested },
    ) as Array<Record<string, unknown>>;

    const needle = query.trim().toLowerCase();
    const relations = rows.map(rowToRelation).filter((rel) =>
      needle.length === 0
        ? true
        : rel.sourceName.toLowerCase().includes(needle) ||
          rel.targetName.toLowerCase().includes(needle) ||
          rel.relationship.toLowerCase().includes(needle),
    );

    return relations.slice(offset, offset + limit);
  }

  async getAll(
    userId: string,
    limit?: number,
    offset = 0,
  ): Promise<GraphRelation[]> {
    await this.ensureInit();
    const requested = limit !== undefined
      ? Math.max(limit + offset, limit)
      : undefined;
    const rows = await this.query(
      requested !== undefined
        ? `MATCH (src:Entity {user_id: $userId})-[r:RELATES_TO]->(tgt:Entity {user_id: $userId})
           RETURN src.id, src.name, r.relationship, tgt.id, tgt.name, r.confidence, r.created_at
           ORDER BY r.created_at DESC LIMIT $limit`
        : `MATCH (src:Entity {user_id: $userId})-[r:RELATES_TO]->(tgt:Entity {user_id: $userId})
           RETURN src.id, src.name, r.relationship, tgt.id, tgt.name, r.confidence, r.created_at`,
      requested !== undefined ? { userId, limit: requested } : { userId },
    ) as Array<Record<string, unknown>>;

    const relations = rows.map(rowToRelation);
    if (limit === undefined) {
      return relations;
    }
    return relations.slice(offset, offset + limit);
  }

  async listEntities(
    userId: string,
    limit = 100,
    offset = 0,
    query = "",
  ): Promise<GraphEntitySummary[]> {
    const relations = await this.getAll(userId);
    const counts = new Map<string, number>();
    for (const rel of relations) {
      counts.set(rel.sourceName, (counts.get(rel.sourceName) ?? 0) + 1);
      counts.set(rel.targetName, (counts.get(rel.targetName) ?? 0) + 1);
    }

    const needle = query.trim().toLowerCase();
    const entities = Array.from(counts.entries())
      .map(([name, relationCount]) => ({ name, relationCount }))
      .filter((entry) =>
        needle.length === 0 ? true : entry.name.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (b.relationCount !== a.relationCount) {
          return b.relationCount - a.relationCount;
        }
        return a.name.localeCompare(b.name);
      });

    return entities.slice(offset, offset + limit);
  }

  async getNeighbors(entityName: string, userId: string): Promise<GraphRelation[]> {
    await this.ensureInit();
    const rows = await this.query(
      `MATCH (src:Entity {name: $name, user_id: $userId})-[r:RELATES_TO]->(tgt:Entity)
       RETURN src.id, src.name, r.relationship, tgt.id, tgt.name, r.confidence, r.created_at`,
      { name: entityName, userId },
    ) as Array<Record<string, unknown>>;

    return rows.map(rowToRelation);
  }

  /** #33: Shared helper — ensure Memory node exists before creating relationships */
  private async ensureMemoryNode(id: string, userId: string): Promise<void> {
    const ts = now();
    const exists = await this.query(
      `MATCH (m:Memory {id: $id}) RETURN m.id`,
      { id },
    ) as Array<unknown>;
    if (exists.length === 0) {
      await this.query(
        `CREATE (m:Memory {id: $id, content: '', user_id: $userId, is_latest: false, version: 1, created_at: $ts, updated_at: $ts})`,
        { id, userId, ts },
      );
    }
  }

  async createUpdate(
    newMemoryId: string,
    oldMemoryId: string,
    reason: string,
  ): Promise<void> {
    await this.ensureInit();
    const ts = now();

    // Ensure Memory nodes exist
    await this.ensureMemoryNode(newMemoryId, "");
    await this.ensureMemoryNode(oldMemoryId, "");

    // Mark old as not latest
    await this.query(
      `MATCH (m:Memory {id: $id}) SET m.is_latest = false, m.updated_at = $ts`,
      { id: oldMemoryId, ts },
    );

    // Create UPDATE relationship
    await this.query(
      `MATCH (new:Memory {id: $newId}), (old:Memory {id: $oldId})
       CREATE (new)-[:UPDATES {reason: $reason, created_at: $ts}]->(old)`,
      { newId: newMemoryId, oldId: oldMemoryId, reason, ts },
    );
  }

  async createExtend(newMemoryId: string, oldMemoryId: string): Promise<void> {
    await this.ensureInit();
    const ts = now();

    // #33: Ensure Memory nodes exist before creating EXTENDS edge
    await this.ensureMemoryNode(newMemoryId, "");
    await this.ensureMemoryNode(oldMemoryId, "");

    await this.query(
      `MATCH (new:Memory {id: $newId}), (old:Memory {id: $oldId})
       CREATE (new)-[:EXTENDS {created_at: $ts}]->(old)`,
      { newId: newMemoryId, oldId: oldMemoryId, ts },
    );
  }

  async deleteAll(userId: string): Promise<void> {
    await this.ensureInit();
    // #19: Delete both Entity AND Memory nodes for this user
    await this.query(
      `MATCH (e:Entity {user_id: $userId}) DETACH DELETE e`,
      { userId },
    );
    await this.query(
      `MATCH (m:Memory {user_id: $userId}) DETACH DELETE m`,
      { userId },
    );
  }

  close(): void {
    this.conn = null;
    this.db = null;
  }
}

function rowToRelation(row: Record<string, unknown>): GraphRelation {
  return {
    sourceId: String(row["src.id"] ?? ""),
    sourceName: String(row["src.name"] ?? ""),
    relationship: String(row["r.relationship"] ?? ""),
    targetId: String(row["tgt.id"] ?? ""),
    targetName: String(row["tgt.name"] ?? ""),
    confidence: Number(row["r.confidence"] ?? 1),
    createdAt: String(row["r.created_at"] ?? new Date().toISOString()),
  };
}
