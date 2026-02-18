import { randomUUID } from "crypto";
import { join } from "path";
import { mkdirSync } from "fs";
import type {
  VectorStore,
  Embedder,
  LLM,
  GraphStore,
  HistoryStore,
  MemoryItem,
  AddOptions,
  AddResult,
  SearchOptions,
  GetAllOptions,
  UserProfile,
  ConversationMessage,
} from "./interfaces/index.js";
import { extractMemories } from "./extraction.js";
import { deduplicate } from "./dedup.js";
import { rewriteQuery } from "./query-rewriting.js";
import { SqliteVecStore } from "./backends/sqlite-vec.js";
import { SqliteHistoryStore } from "./backends/sqlite-history.js";
import { KuzuGraphStore } from "./backends/kuzu.js";
import { OpenAICompatLLM } from "./backends/openai-compat-llm.js";
import { OpenAICompatEmbedder } from "./backends/openai-compat-embedder.js";
import {
  buildEntityExtractionPrompt,
  parseEntityExtractionResponse,
} from "./prompts/entity-extraction.js";
import { buildProfileSummary } from "./prompts/profile.js";
import { now, hashContent } from "./utils/index.js";
import { payloadToMemory } from "./utils/conversion.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/** No-op logger used when no logger is provided */
export const nullLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

// ---------------------------------------------------------------------------
// Config — what the user passes in
// ---------------------------------------------------------------------------

export interface ClawMemConfig {
  /** Data directory — all DB files go here */
  dataDir: string;

  llm: {
    baseURL: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };

  embedder: {
    baseURL: string;
    apiKey?: string;
    model?: string;
    dimension?: number;
  };

  /** Enable graph memory (Kùzu). Default: true */
  enableGraph?: boolean;

  /** Deduplication similarity threshold. Default: 0.85 */
  dedupThreshold?: number;

  /** Default search result limit. Default: 10 */
  defaultTopK?: number;

  /** Default search similarity threshold. Default: 0.5 */
  defaultThreshold?: number;

  /** Max memories per user. Default: 10000 */
  maxMemories?: number;

  /** Custom extraction instructions */
  customInstructions?: string;

  /**
   * Automatic forgetting rules (retention days per memory type).
   * 0 = never expire. Default: all 0 (never expire).
   */
  forgettingRules?: {
    fact?: number;
    preference?: number;
    episode?: number;
  };

  /** Enable LLM-based query rewriting for short queries (P4-5). Default: false */
  enableQueryRewriting?: boolean;

  /** Optional logger for diagnostics */
  logger?: Logger;

  // Advanced: override backends
  vectorStore?: VectorStore;
  graphStore?: GraphStore;
  historyStore?: HistoryStore;
  llmInstance?: LLM;
  embedderInstance?: Embedder;
}

/** Resolved scalar settings (no instance refs). Used internally. */
export interface ClawMemSettings {
  dataDir: string;
  llm: ClawMemConfig["llm"];
  embedder: ClawMemConfig["embedder"];
  enableGraph: boolean;
  dedupThreshold: number;
  defaultTopK: number;
  defaultThreshold: number;
  maxMemories: number;
  customInstructions: string;
  forgettingRules: { fact: number; preference: number; episode: number };
  enableQueryRewriting: boolean;
}

// ---------------------------------------------------------------------------
// Memory — the main entry point
// ---------------------------------------------------------------------------

export class Memory {
  private readonly vectorStore: VectorStore;
  private readonly graphStore: GraphStore | null;
  private readonly historyStore: HistoryStore;
  private readonly llm: LLM;
  private readonly embedder: Embedder;
  private readonly config: ClawMemSettings;
  private readonly log: Logger;

  constructor(config: ClawMemConfig) {
    // Resolve data directory
    mkdirSync(config.dataDir, { recursive: true });

    this.log = config.logger ?? nullLogger;

    // Fill in defaults (scalars only — no instance refs)
    this.config = {
      dataDir: config.dataDir,
      llm: config.llm,
      embedder: config.embedder,
      enableGraph: config.enableGraph ?? true,
      dedupThreshold: config.dedupThreshold ?? 0.85,
      defaultTopK: config.defaultTopK ?? 10,
      defaultThreshold: config.defaultThreshold ?? 0.5,
      maxMemories: config.maxMemories ?? 10000,
      customInstructions: config.customInstructions ?? "",
      forgettingRules: {
        fact: config.forgettingRules?.fact ?? 0,
        preference: config.forgettingRules?.preference ?? 0,
        episode: config.forgettingRules?.episode ?? 0,
      },
      enableQueryRewriting: config.enableQueryRewriting ?? false,
    };

    // Initialize backends
    this.llm = config.llmInstance ?? new OpenAICompatLLM(config.llm);
    this.embedder =
      config.embedderInstance ??
      new OpenAICompatEmbedder(config.embedder);

    this.vectorStore =
      config.vectorStore ??
      new SqliteVecStore({
        dbPath: join(config.dataDir, "vector.db"),
        dimension: config.embedder.dimension ?? 768,
      });

    this.historyStore =
      config.historyStore ??
      new SqliteHistoryStore({
        dbPath: join(config.dataDir, "history.db"),
      });

    this.graphStore =
      config.enableGraph !== false
        ? (config.graphStore ??
          new KuzuGraphStore({
            dbPath: join(config.dataDir, "graph.kuzu"),
          }))
        : null;
  }

  // ---------------------------------------------------------------------------
  // add() — extract, dedup, store
  // ---------------------------------------------------------------------------

  async add(
    messages: ConversationMessage[],
    options: AddOptions,
  ): Promise<AddResult> {
    const result: AddResult = {
      added: [],
      updated: [],
      deduplicated: 0,
      graphRelations: [],
    };

    // Extract memories from conversation
    const extracted = await extractMemories(
      messages,
      this.llm,
      this.embedder,
      {
        ...options,
        customInstructions:
          options.customInstructions ?? this.config.customInstructions,
      },
    );

    if (extracted.length === 0) return result;

    // Dedup and store each memory
    for (const mem of extracted) {
      const dedupResult = await deduplicate(mem, this.vectorStore, this.embedder, this.llm, {
        semanticThreshold: this.config.dedupThreshold,
      });

      const { decision, candidateMemory } = dedupResult;

      if (decision.action === "skip") {
        result.deduplicated++;
        continue;
      }

      if (decision.action === "update" && candidateMemory) {
        // Mark old memory as not latest — reuse existing embedding (content unchanged)
        const oldPayload = await this.vectorStore.get(candidateMemory.id);
        if (oldPayload) {
          const updatedOld = {
            ...oldPayload.payload,
            isLatest: false,
            updatedAt: now(),
          };
          await this.vectorStore.updatePayload(candidateMemory.id, updatedOld);
        }

        // Store new memory
        const newMem: MemoryItem = {
          ...mem,
          version: (candidateMemory.version ?? 1) + 1,
          isLatest: true,
        };
        await this.vectorStore.insert([mem.embedding], [newMem.id], [
          this.memoryToPayload(newMem),
        ]);

        // Record UPDATE relationship in graph
        if (this.graphStore) {
          await this.graphStore.createUpdate(
            newMem.id,
            candidateMemory.id,
            decision.reason,
          );
        }

        // History
        await this.historyStore.add({
          memoryId: newMem.id,
          action: "add",
          previousValue: null,
          newValue: newMem.memory,
          userId: options.userId,
        });
        await this.historyStore.add({
          memoryId: candidateMemory.id,
          action: "update",
          previousValue: candidateMemory.memory,
          newValue: newMem.memory,
          userId: options.userId,
        });

        result.updated.push(newMem);
        continue;
      }

      if (decision.action === "extend" && candidateMemory) {
        // Store new memory
        await this.vectorStore.insert([mem.embedding], [mem.id], [
          this.memoryToPayload(mem),
        ]);

        if (this.graphStore) {
          await this.graphStore.createExtend(mem.id, candidateMemory.id);
        }

        await this.historyStore.add({
          memoryId: mem.id,
          action: "add",
          previousValue: null,
          newValue: mem.memory,
          userId: options.userId,
        });

        result.added.push(mem);
        continue;
      }

      // action === "add"
      await this.vectorStore.insert([mem.embedding], [mem.id], [
        this.memoryToPayload(mem),
      ]);

      await this.historyStore.add({
        memoryId: mem.id,
        action: "add",
        previousValue: null,
        newValue: mem.memory,
        userId: options.userId,
      });

      // Extract entities for graph
      if (this.graphStore && options.enableGraph !== false) {
        await this.addToGraph(mem, options.userId);
      }

      result.added.push(mem);
    }

    return result;
  }

  private async addToGraph(
    mem: MemoryItem,
    userId: string,
  ): Promise<void> {
    try {
      const raw = await this.llm.complete(
        [
          { role: "system", content: buildEntityExtractionPrompt() },
          { role: "user", content: mem.memory },
        ],
        { json: true },
      );
      const { entities, relations } = parseEntityExtractionResponse(raw);
      if (entities.length > 0) {
        await this.graphStore!.addEntities(
          entities.map((e) => ({ ...e, userId })),
          relations.map((r) => ({
            sourceId: "",
            sourceName: r.source,
            relationship: r.relationship,
            targetId: "",
            targetName: r.target,
            confidence: r.confidence ?? 1.0,
          })),
        );
      }
    } catch (err) {
      // Graph enrichment is best-effort — don't fail the add
      this.log.warn("Graph enrichment failed for memory %s: %s", mem.id, err);
    }
  }

  // ---------------------------------------------------------------------------
  // search()
  // ---------------------------------------------------------------------------

  async search(query: string, options: SearchOptions): Promise<MemoryItem[]> {
    const limit = options.limit ?? this.config.defaultTopK;
    const threshold = options.threshold ?? this.config.defaultThreshold;

    // Query rewriting (P4-5) — expand short/vague queries
    const effectiveQuery = this.config.enableQueryRewriting
      ? await rewriteQuery(query, this.llm)
      : query;

    const queryEmbedding = await this.embedder.embed(effectiveQuery);
    const vectorResults = await this.vectorStore.search(queryEmbedding, limit * 2, {
      userId: options.userId,
      isLatest: true,
    });

    let results = vectorResults
      .filter((r) => r.score >= threshold)
      .map((r) => this.toMemoryItem(r.id, r.payload, r.score));

    // Category filter
    if (options.category) {
      results = results.filter((m) => m.category === options.category);
    }

    // Memory type filter
    if (options.memoryType) {
      results = results.filter((m) => m.memoryType === options.memoryType);
    }

    // Date range filter
    if (options.fromDate || options.toDate) {
      results = results.filter((m) => {
        const date = m.eventDate ?? m.createdAt;
        if (options.fromDate && date < options.fromDate) return false;
        if (options.toDate && date > options.toDate) return false;
        return true;
      });
    }

    // Memory type scoring (P4-3)
    // - preference: slight boost (+10%)
    // - episode: decay based on age (max 30% penalty for memories > 30 days old)
    // - fact: neutral
    results = results.map((m) => {
      if (!m.memoryType || !m.score) return m;
      let multiplier = 1.0;
      if (m.memoryType === "preference") {
        multiplier = 1.1;
      } else if (m.memoryType === "episode") {
        const ageMs = Date.now() - new Date(m.createdAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        multiplier = Math.max(0.7, 1.0 - (ageDays / 100) * 0.3);
      }
      return { ...m, score: Math.min(1.0, m.score * multiplier) };
    });

    // Keyword search blend
    if (options.keywordSearch && this.vectorStore.keywordSearch) {
      const kwResults = await this.vectorStore.keywordSearch(effectiveQuery, limit, {
        userId: options.userId,
      });
      const kwMemories = kwResults.map((r) =>
        this.toMemoryItem(r.id, r.payload, r.score * 0.7),
      );

      // Merge, deduplicate by id, prefer higher score
      const merged = new Map<string, MemoryItem>();
      for (const m of [...results, ...kwMemories]) {
        const existing = merged.get(m.id);
        if (!existing || (m.score ?? 0) > (existing.score ?? 0)) {
          merged.set(m.id, m);
        }
      }
      results = Array.from(merged.values());
    }

    return results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // get() / getAll() / delete() / deleteAll() / update()
  // ---------------------------------------------------------------------------

  async get(id: string): Promise<MemoryItem | null> {
    const result = await this.vectorStore.get(id);
    if (!result) return null;
    return this.toMemoryItem(result.id, result.payload, 1);
  }

  async getAll(options: GetAllOptions): Promise<MemoryItem[]> {
    const [results] = await this.vectorStore.list(
      { userId: options.userId },
      options.limit ?? 1000,
      options.offset ?? 0,
    );

    let memories = results.map((r) =>
      this.toMemoryItem(r.id, r.payload, 1),
    );

    if (options.onlyLatest !== false) {
      memories = memories.filter((m) => m.isLatest !== false);
    }
    if (options.category) {
      memories = memories.filter((m) => m.category === options.category);
    }
    if (options.memoryType) {
      memories = memories.filter((m) => m.memoryType === options.memoryType);
    }

    return memories;
  }

  async delete(id: string): Promise<void> {
    const mem = await this.get(id);
    await this.vectorStore.delete(id);
    if (mem) {
      await this.historyStore.add({
        memoryId: id,
        action: "delete",
        previousValue: mem.memory,
        newValue: null,
        userId: mem.userId,
      });
    }
  }

  async deleteAll(userId: string): Promise<void> {
    await this.vectorStore.deleteAll({ userId });
    if (this.graphStore) {
      await this.graphStore.deleteAll(userId);
    }
    await this.historyStore.reset(userId);
  }

  async update(id: string, memory: string): Promise<MemoryItem | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const embedding = await this.embedder.embed(memory);
    const updated: MemoryItem = {
      ...existing,
      memory,
      hash: hashContent(memory),
      updatedAt: now(),
      version: existing.version + 1,
    };

    await this.vectorStore.update(id, embedding, this.memoryToPayload(updated));

    await this.historyStore.add({
      memoryId: id,
      action: "update",
      previousValue: existing.memory,
      newValue: memory,
      userId: existing.userId,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // profile() — build structured user profile
  // ---------------------------------------------------------------------------

  async profile(userId: string): Promise<UserProfile> {
    const allMemories = await this.getAll({ userId, onlyLatest: true });
    const ts = now();

    // Classify by category
    const byCategory = (cats: string[]) =>
      allMemories.filter((m) => cats.includes(m.category ?? "other"));

    return {
      userId,
      static: {
        identity: byCategory(["identity"]),
        preferences: byCategory(["preferences"]),
        technical: byCategory(["technical", "infrastructure"]),
        relationships: byCategory(["relationships"]),
      },
      dynamic: {
        goals: byCategory(["goals"]),
        projects: byCategory(["projects"]),
        lifeEvents: byCategory(["life_events"]),
      },
      other: byCategory(["knowledge", "health", "finance", "assistant", "other"]),
      generatedAt: ts,
    };
  }

  /** Get history for a memory */
  async history(memoryId: string) {
    return this.historyStore.getHistory(memoryId);
  }

  /** Get graph relations for a user */
  async graphRelations(userId: string) {
    if (!this.graphStore) return [];
    return this.graphStore.getAll(userId);
  }

  // ---------------------------------------------------------------------------
  // retentionScanner() — P4-2: Automatic forgetting
  // ---------------------------------------------------------------------------

  /**
   * Scan memories for expired items based on forgettingRules config.
   * Returns a list of expired memories. If `autoDelete` is true, deletes them.
   *
   * Rule: if `forgettingRules.episode = 30`, episodes older than 30 days expire.
   * Rule: eventDate is used if present, otherwise createdAt.
   */
  async retentionScanner(
    userId: string,
    opts: { autoDelete?: boolean } = {},
  ): Promise<{ expired: MemoryItem[]; deleted: number }> {
    const rules = this.config.forgettingRules;
    if (!rules || Object.keys(rules).length === 0) {
      return { expired: [], deleted: 0 };
    }

    const allMemories = await this.getAll({ userId, onlyLatest: true });
    const now = Date.now();
    const expired: MemoryItem[] = [];

    for (const mem of allMemories) {
      const type = mem.memoryType ?? "fact";
      const retentionDays = (rules as Record<string, number>)[type] ?? 0;
      if (retentionDays <= 0) continue;

      const referenceDate = mem.eventDate ?? mem.createdAt;
      const ageMs = now - new Date(referenceDate).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays > retentionDays) {
        expired.push(mem);
      }
    }

    let deleted = 0;
    if (opts.autoDelete && expired.length > 0) {
      for (const mem of expired) {
        await this.delete(mem.id);
        deleted++;
      }
    }

    return { expired, deleted };
  }

  // ---------------------------------------------------------------------------
  // exportMarkdown() / importMarkdown() — P3-6: Markdown sync
  // ---------------------------------------------------------------------------

  /**
   * Export memories to markdown files organized by date.
   * Creates one file per day: `outputDir/YYYY-MM-DD.md`
   *
   * Returns the paths of files written.
   */
  async exportMarkdown(
    userId: string,
    outputDir: string,
    opts: { onlyLatest?: boolean } = {},
  ): Promise<string[]> {
    const { mkdirSync, writeFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");

    mkdirSync(outputDir, { recursive: true });

    const memories = await this.getAll({
      userId,
      onlyLatest: opts.onlyLatest ?? true,
      limit: 100000,
    });

    // Group by date
    const byDate = new Map<string, MemoryItem[]>();
    for (const mem of memories) {
      const dateStr = (mem.eventDate ?? mem.createdAt).slice(0, 10);
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(mem);
    }

    const written: string[] = [];

    for (const [date, mems] of byDate) {
      const lines: string[] = [
        `# ClawMem Export — ${date}`,
        `> User: ${userId} | Exported: ${new Date().toISOString()}`,
        "",
      ];

      // Group by category within the day
      const byCategory = new Map<string, MemoryItem[]>();
      for (const m of mems) {
        const cat = m.category ?? "other";
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(m);
      }

      for (const [cat, catMems] of byCategory) {
        lines.push(`## ${cat}`);
        lines.push("");
        for (const m of catMems) {
          const type = m.memoryType ? ` *(${m.memoryType})*` : "";
          const id = `<!-- id:${m.id} -->`;
          lines.push(`- ${m.memory}${type} ${id}`);
        }
        lines.push("");
      }

      const filePath = pathJoin(outputDir, `${date}.md`);
      writeFileSync(filePath, lines.join("\n"));
      written.push(filePath);
    }

    // Also write a MEMORY.md summary (latest facts)
    const summaryPath = pathJoin(outputDir, "MEMORY.md");
    const summary = [
      `# Memory — ${userId}`,
      `> Last synced: ${new Date().toISOString()}`,
      "",
    ];
    const profile = await this.profile(userId);
    if (profile.static.identity.length > 0) {
      summary.push("## Identity");
      for (const m of profile.static.identity) summary.push(`- ${m.memory}`);
      summary.push("");
    }
    if (profile.static.preferences.length > 0) {
      summary.push("## Preferences");
      for (const m of profile.static.preferences) summary.push(`- ${m.memory}`);
      summary.push("");
    }
    if (profile.static.technical.length > 0) {
      summary.push("## Technical");
      for (const m of profile.static.technical) summary.push(`- ${m.memory}`);
      summary.push("");
    }
    if (profile.dynamic.goals.length > 0) {
      summary.push("## Goals");
      for (const m of profile.dynamic.goals) summary.push(`- ${m.memory}`);
      summary.push("");
    }
    if (profile.dynamic.projects.length > 0) {
      summary.push("## Projects");
      for (const m of profile.dynamic.projects) summary.push(`- ${m.memory}`);
      summary.push("");
    }
    writeFileSync(summaryPath, summary.join("\n"));
    written.push(summaryPath);

    return written;
  }

  /**
   * Import memories from a markdown file.
   * Treats each bullet point `- text` as a memory to add.
   * Uses LLM extraction (same as `add()`).
   */
  async importMarkdown(
    filePath: string,
    userId: string,
    opts: { customInstructions?: string } = {},
  ): Promise<{ added: number; updated: number; skipped: number }> {
    const { readFileSync } = await import("fs");
    const content = readFileSync(filePath, "utf-8");

    // Extract bullet points — support both MEMORY.md (no IDs) and date files (with IDs)
    const bullets = content
      .split("\n")
      .filter((line) => line.match(/^[-*]\s+(.+)/))
      .map((line) => line
        .replace(/^[-*]\s+/, "")
        .replace(/\s*<!--\s*id:[^>]*-->\s*$/, "")   // strip <!-- id:... -->
        .replace(/\s*\*\(.*?\)\*\s*$/, "")            // strip *(type)*
        .trim()
      )
      .filter((line) => line.length > 5);

    if (bullets.length === 0) {
      return { added: 0, updated: 0, skipped: 0 };
    }

    // Batch into groups of 10 and add
    let totalAdded = 0, totalUpdated = 0, totalSkipped = 0;
    const batchSize = 10;

    for (let i = 0; i < bullets.length; i += batchSize) {
      const batch = bullets.slice(i, i + batchSize);
      const messages: ConversationMessage[] = batch.map((b) => ({ role: "user" as const, content: b }));
      const result = await this.add(messages, {
        userId,
        ...(opts.customInstructions !== undefined && { customInstructions: opts.customInstructions }),
      });
      totalAdded += result.added.length;
      totalUpdated += result.updated.length;
      totalSkipped += result.deduplicated;
    }

    return { added: totalAdded, updated: totalUpdated, skipped: totalSkipped };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private memoryToPayload(mem: MemoryItem): Record<string, unknown> {
    return {
      memory: mem.memory,
      userId: mem.userId,
      category: mem.category,
      memoryType: mem.memoryType,
      createdAt: mem.createdAt,
      updatedAt: mem.updatedAt,
      isLatest: mem.isLatest,
      version: mem.version,
      eventDate: mem.eventDate,
      hash: mem.hash,
      metadata: mem.metadata ?? {},
    };
  }

  private toMemoryItem(
    id: string,
    payload: Record<string, unknown>,
    score: number,
  ): MemoryItem {
    return payloadToMemory(id, payload, score);
  }
}
