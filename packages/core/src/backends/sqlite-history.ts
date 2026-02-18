import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { HistoryStore, HistoryEntry } from "../interfaces/index.js";

export interface SqliteHistoryConfig {
  dbPath: string;
}

export class SqliteHistoryStore implements HistoryStore {
  private db: Database.Database;

  constructor(config: SqliteHistoryConfig) {
    this.db = new Database(config.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        action TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS history_memory_id ON memory_history(memory_id);
      CREATE INDEX IF NOT EXISTS history_user_id ON memory_history(user_id);
    `);
  }

  async add(entry: Omit<HistoryEntry, "id" | "createdAt">): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memory_history (id, memory_id, action, previous_value, new_value, user_id)
         VALUES (@id, @memoryId, @action, @previousValue, @newValue, @userId)`,
      )
      .run({
        id: randomUUID(),
        memoryId: entry.memoryId,
        action: entry.action,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        userId: entry.userId,
      });
  }

  async getHistory(memoryId: string): Promise<HistoryEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT id, memory_id, action, previous_value, new_value, user_id, created_at
         FROM memory_history WHERE memory_id = ? ORDER BY created_at ASC`,
      )
      .all(memoryId) as Array<{
      id: string;
      memory_id: string;
      action: string;
      previous_value: string | null;
      new_value: string | null;
      user_id: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      memoryId: r.memory_id,
      action: r.action as HistoryEntry["action"],
      previousValue: r.previous_value,
      newValue: r.new_value,
      userId: r.user_id,
      createdAt: r.created_at,
    }));
  }

  async reset(userId?: string): Promise<void> {
    if (userId) {
      this.db
        .prepare(`DELETE FROM memory_history WHERE user_id = ?`)
        .run(userId);
    } else {
      this.db.exec(`DELETE FROM memory_history`);
    }
  }

  close(): void {
    this.db.close();
  }
}
