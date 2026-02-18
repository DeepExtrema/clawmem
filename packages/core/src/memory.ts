import { randomUUID } from "crypto";
import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import type {
  VectorStore,
  Embedder,
  LLM,
  GraphStore,
  GraphRelation,
  GraphEntitySummary,
  HistoryStore,
  MemoryItem,
  AddOptions,
  AddResult,
  SearchOptions,
  GetAllOptions,
  UserProfile,
  ConversationMessage,
  LLMConfig,
  EmbedderConfig,
  Reranker,
} from "./interfaces/index.js";
import { extractMemories } from "./extraction.js";
import { deduplicate } from "./dedup.js";
import { rewriteQuery } from "./query-rewriting.js";
import { SqliteVecStore } from "./backends/sqlite-vec.js";
import { SqliteHistoryStore } from "./backends/sqlite-history.js";
import { KuzuGraphStore } from "./backends/kuzu.js";
import { OpenAICompatLLM } from "./backends/openai-compat-llm.js";
import { OpenAICompatEmbedder } from "./backends/openai-compat-embedder.js";
import { NoopReranker } from "./backends/noop-reranker.js";
import {
  buildEntityExtractionPrompt,
  parseEntityExtractionResponse,
} from "./prompts/entity-extraction.js";
import { parseBullets } from "./utils/parse-bullets.js";
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

  llm: LLMConfig;

  embedder: EmbedderConfig;

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

  /** Optional reranker stage after vector retrieval (default: NoopReranker) */
  reranker?: Reranker;

  /** Top-k passed to reranker (default: defaultTopK * 2) */
  rerankerTopK?: number;

  /** Query cache TTL for rewrite+embedding (default: 60000ms) */
  queryCacheTtlMs?: number;

  /** Query cache max entries (default: 200) */
  queryCacheMaxEntries?: number;

  /** Optional logger for diagnostics */
  logger?: Logger;

  /**
   * Encryption at rest (future).
   * When set, SQLite databases use SQLCipher with this passphrase.
   * Requires `better-sqlite3` compiled with SQLCipher support.
   * See docs/encryption.md for setup instructions.
   */
  encryption?: {
    /** Passphrase for SQLCipher encryption */
    passphrase: string;
  };

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
  queryCacheTtlMs: number;
  queryCacheMaxEntries: number;
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
  private readonly reranker: Reranker;
  private readonly config: ClawMemSettings;
  private readonly log: Logger;
  private readonly rerankerTopK: number | undefined;
  private readonly searchCache = new Map<string, {
    effectiveQuery: string;
    embedding: number[];
    expiresAt: number;
  }>();

  constructor(config: ClawMemConfig) {
    if (config.encryption) {
      throw new Error(
        "encryption.passphrase is configured, but encryption-at-rest is not implemented yet. Remove the encryption config or use filesystem encryption for now.",
      );
    }

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
      queryCacheTtlMs: config.queryCacheTtlMs ?? 60_000,
      queryCacheMaxEntries: config.queryCacheMaxEntries ?? 200,
    };

    // Initialize backends
    this.llm = config.llmInstance ?? new OpenAICompatLLM(config.llm);
    this.embedder =
      config.embedderInstance ??
      new OpenAICompatEmbedder(config.embedder);
    this.reranker = config.reranker ?? new NoopReranker();
    this.rerankerTopK = config.rerankerTopK;

    this.vectorStore =
      config.vectorStore ??
      new SqliteVecStore({
        dbPath: join(config.dataDir, "vector.db"),
        dimension: config.embedder.dimension ?? 768,
        logger: this.log,
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

    // #55: Enforce maxMemories limit
    const [, currentCount] = await this.vectorStore.list(
      { userId: options.userId, isLatest: true },
      0, // limit=0, we only need the count
      0,
    );
    if (currentCount >= this.config.maxMemories) {
      this.log.warn(
        "maxMemories limit reached (%d/%d) for user %s — rejecting add",
        currentCount, this.config.maxMemories, options.userId,
      );
      return result;
    }

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

    // Collect memories needing graph enrichment (parallelized after loop)
    const graphQueue: MemoryItem[] = [];

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

        // Record UPDATE relationship in graph (#18: best-effort, wrapped in try/catch)
        if (this.graphStore) {
          try {
            await this.graphStore.createUpdate(
              newMem.id,
              candidateMemory.id,
              decision.reason,
            );
          } catch (err) {
            this.log.warn("Graph createUpdate failed for %s→%s: %s", newMem.id, candidateMemory.id, err);
          }
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
          try {
            await this.graphStore.createExtend(mem.id, candidateMemory.id);
          } catch (err) {
            this.log.warn("Graph createExtend failed for %s→%s: %s", mem.id, candidateMemory.id, err);
          }
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

      // Queue entity extraction for graph (batched after loop)
      if (this.graphStore && options.enableGraph !== false) {
        graphQueue.push(mem);
      }

      result.added.push(mem);
    }

    // Parallel graph enrichment for all newly added memories (#61)
    if (graphQueue.length > 0) {
      await Promise.all(
        graphQueue.map((m) => this.addToGraph(m, options.userId)),
      );
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
          userId,
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
    const fetchLimit = Math.max(limit * 2, 10);
    const rerankerTopK = this.rerankerTopK ?? fetchLimit;

    const { effectiveQuery, queryEmbedding } = await this.resolveSearchContext(
      query,
      options.userId,
    );

    const searchFilters: Record<string, unknown> = {
      userId: options.userId,
      isLatest: true,
      ...(options.category !== undefined && { category: options.category }),
      ...(options.memoryType !== undefined && { memoryType: options.memoryType }),
      ...(options.fromDate !== undefined && { fromDate: options.fromDate }),
      ...(options.toDate !== undefined && { toDate: options.toDate }),
    };

    const vectorResults = await this.vectorStore.search(
      queryEmbedding,
      fetchLimit,
      searchFilters,
    );
    const rerankedResults = await this.reranker.rerank(
      effectiveQuery,
      vectorResults,
      rerankerTopK,
    );

    let results = rerankedResults
      .filter((r) => r.score >= threshold)
      .map((r) => this.toMemoryItem(r.id, r.payload, r.score));

    // Keep local filter pass for backend compatibility if custom stores ignore filters.
    results = this.applyPostSearchFilters(results, options);
    results = this.applyMemoryTypeScoring(results);

    // Keyword search blend
    if (options.keywordSearch && this.vectorStore.keywordSearch) {
      const kwResults = await this.vectorStore.keywordSearch(
        effectiveQuery,
        limit,
        searchFilters,
      );
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

    return this.sortAndLimitResults(results, limit);
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
    // #23: Push isLatest filter to SQL for efficiency
    const isLatest = options.onlyLatest !== false ? true : undefined;
    const [results] = await this.vectorStore.list(
      {
        userId: options.userId,
        ...(isLatest !== undefined && { isLatest }),
        ...(options.category !== undefined && { category: options.category }),
        ...(options.memoryType !== undefined && { memoryType: options.memoryType }),
      },
      options.limit ?? 1000,
      options.offset ?? 0,
    );

    let memories = results.map((r) =>
      this.toMemoryItem(r.id, r.payload, 1),
    );

    if (options.category) {
      memories = memories.filter((m) => m.category === options.category);
    }
    if (options.memoryType) {
      memories = memories.filter((m) => m.memoryType === options.memoryType);
    }

    return memories;
  }

  async delete(id: string): Promise<void> {
    // #52: Record history BEFORE delete (write-ahead pattern)
    const mem = await this.get(id);
    if (mem) {
      await this.historyStore.add({
        memoryId: id,
        action: "delete",
        previousValue: mem.memory,
        newValue: null,
        userId: mem.userId,
      });
    }
    await this.vectorStore.delete(id);
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
    return this.categorizeForProfile(userId, allMemories);
  }

  /** Get history for a memory */
  async history(memoryId: string) {
    return this.historyStore.getHistory(memoryId);
  }

  /** Get graph relations for a user */
  async graphRelations(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<GraphRelation[]> {
    if (!this.graphStore) return [];
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const requested = Math.max(limit + offset, limit);
    const relations = await this.graphStore.getAll(userId, requested, 0);
    return relations.slice(offset, offset + limit);
  }

  /** Search graph relationships by entity/query text */
  async graphSearch(
    query: string,
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<GraphRelation[]> {
    if (!this.graphStore) return [];
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const requested = Math.max(limit + offset, limit);
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return this.graphRelations(userId, opts);
    }

    const neighbors = await this.graphStore.getNeighbors(query, userId);
    const neighborMatches = neighbors.filter(
      (r) =>
        r.sourceName.toLowerCase().includes(needle) ||
        r.targetName.toLowerCase().includes(needle),
    );
    if (neighborMatches.length > 0) {
      return neighborMatches.slice(offset, offset + limit);
    }

    const candidates = await this.graphStore.search(
      query,
      userId,
      requested * 2,
      0,
    );
    const matches = candidates.filter(
      (r) =>
        r.sourceName.toLowerCase().includes(needle) ||
        r.targetName.toLowerCase().includes(needle),
    );
    return matches.slice(offset, offset + limit);
  }

  /** List graph entities and relation counts */
  async graphEntities(
    userId: string,
    opts: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<GraphEntitySummary[]> {
    if (!this.graphStore) return [];
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    if (this.graphStore.listEntities) {
      return this.graphStore.listEntities(userId, limit, offset, opts.query);
    }

    const relations = await this.graphStore.getAll(userId);
    const counts = new Map<string, number>();
    for (const rel of relations) {
      counts.set(rel.sourceName, (counts.get(rel.sourceName) ?? 0) + 1);
      counts.set(rel.targetName, (counts.get(rel.targetName) ?? 0) + 1);
    }

    const needle = opts.query?.trim().toLowerCase();
    const entities = Array.from(counts.entries())
      .map(([name, relationCount]) => ({ name, relationCount }))
      .filter((e) =>
        needle ? e.name.toLowerCase().includes(needle) : true,
      )
      .sort((a, b) => {
        if (b.relationCount !== a.relationCount) {
          return b.relationCount - a.relationCount;
        }
        return a.name.localeCompare(b.name);
      });

    return entities.slice(offset, offset + limit);
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
    const { fact, preference, episode } = rules;
    if (fact <= 0 && preference <= 0 && episode <= 0) {
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
      // #30: Record history for each, then batch delete
      for (const mem of expired) {
        await this.historyStore.add({
          memoryId: mem.id,
          action: "delete",
          previousValue: mem.memory,
          newValue: null,
          userId: mem.userId,
        });
      }
      for (const mem of expired) {
        await this.vectorStore.delete(mem.id);
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
    const { join: pathJoin } = await import("path");

    mkdirSync(outputDir, { recursive: true });

    // #62: Paginate instead of loading all memories at once
    const PAGE_SIZE = 1000;
    const memories: MemoryItem[] = [];
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await this.getAll({
        userId,
        onlyLatest: opts.onlyLatest ?? true,
        limit: PAGE_SIZE,
        offset,
      });
      memories.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

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

    // Also write a MEMORY.md summary using buildProfileSummary (#22 DRY, #29 no double-fetch)
    const summaryPath = pathJoin(outputDir, "MEMORY.md");
    const profileData = this.categorizeForProfile(userId, memories);
    const profileSummary = buildProfileSummary(profileData);
    const summaryContent = [
      `# Memory — ${userId}`,
      `> Last synced: ${new Date().toISOString()}`,
      "",
      profileSummary,
    ].join("\n");
    writeFileSync(summaryPath, summaryContent);
    written.push(summaryPath);

    return written;
  }

  /** Build a UserProfile from pre-fetched memories (avoids extra DB fetch) */
  private categorizeForProfile(userId: string, allMemories: MemoryItem[]): UserProfile {
    const ts = now();
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
    const content = readFileSync(filePath, "utf-8");

    // #43: Use extracted parseBullets utility
    const bullets = parseBullets(content);

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
  // close() — release resources (#17)
  // ---------------------------------------------------------------------------

  close(): void {
    this.searchCache.clear();
    if ("close" in this.vectorStore && typeof (this.vectorStore as { close: () => void }).close === "function") {
      (this.vectorStore as { close: () => void }).close();
    }
    if ("close" in this.historyStore && typeof (this.historyStore as { close: () => void }).close === "function") {
      (this.historyStore as { close: () => void }).close();
    }
    if (this.graphStore) {
      this.graphStore.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveSearchContext(
    query: string,
    userId: string,
  ): Promise<{ effectiveQuery: string; queryEmbedding: number[] }> {
    const cacheKey = this.buildSearchCacheKey(query, userId);
    const cached = this.getCachedSearchContext(cacheKey);
    if (cached) {
      return { effectiveQuery: cached.effectiveQuery, queryEmbedding: cached.embedding };
    }

    const effectiveQuery = this.config.enableQueryRewriting
      ? await rewriteQuery(query, this.llm)
      : query;
    const queryEmbedding = await this.embedder.embed(effectiveQuery);

    this.setCachedSearchContext(cacheKey, {
      effectiveQuery,
      embedding: queryEmbedding,
      expiresAt: Date.now() + this.config.queryCacheTtlMs,
    });

    return { effectiveQuery, queryEmbedding };
  }

  private buildSearchCacheKey(query: string, userId: string): string {
    return JSON.stringify({
      userId,
      query,
      rewrite: this.config.enableQueryRewriting,
    });
  }

  private getCachedSearchContext(
    key: string,
  ): { effectiveQuery: string; embedding: number[]; expiresAt: number } | null {
    const entry = this.searchCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.searchCache.delete(key);
      return null;
    }
    // Touch for LRU behavior.
    this.searchCache.delete(key);
    this.searchCache.set(key, entry);
    return entry;
  }

  private setCachedSearchContext(
    key: string,
    value: { effectiveQuery: string; embedding: number[]; expiresAt: number },
  ): void {
    if (!this.searchCache.has(key) && this.searchCache.size >= this.config.queryCacheMaxEntries) {
      const oldest = this.searchCache.keys().next().value;
      if (oldest !== undefined) {
        this.searchCache.delete(oldest);
      }
    }
    this.searchCache.set(key, value);
  }

  private applyPostSearchFilters(
    results: MemoryItem[],
    options: SearchOptions,
  ): MemoryItem[] {
    let filtered = results;

    if (options.category) {
      filtered = filtered.filter((m) => m.category === options.category);
    }
    if (options.memoryType) {
      filtered = filtered.filter((m) => m.memoryType === options.memoryType);
    }
    if (options.fromDate || options.toDate) {
      filtered = filtered.filter((m) => {
        const date = m.eventDate ?? m.createdAt;
        if (options.fromDate && date < options.fromDate) return false;
        if (options.toDate && date > options.toDate) return false;
        return true;
      });
    }

    return filtered;
  }

  private applyMemoryTypeScoring(results: MemoryItem[]): MemoryItem[] {
    // P4-3:
    // - preference: slight boost (+10%)
    // - episode: decay based on age (max 30% penalty for memories > 30 days old)
    // - fact: neutral
    return results.map((m) => {
      if (!m.memoryType || m.score === undefined) return m;
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
  }

  private sortAndLimitResults(results: MemoryItem[], limit: number): MemoryItem[] {
    return results
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

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
