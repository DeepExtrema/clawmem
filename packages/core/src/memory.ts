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

// ---------------------------------------------------------------------------
// Config
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

  // Advanced: override backends
  vectorStore?: VectorStore;
  graphStore?: GraphStore;
  historyStore?: HistoryStore;
  llmInstance?: LLM;
  embedderInstance?: Embedder;
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
  private readonly config: Required<ClawMemConfig>;

  constructor(config: ClawMemConfig) {
    // Resolve data directory
    mkdirSync(config.dataDir, { recursive: true });

    // Fill in defaults
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
      vectorStore: config.vectorStore!,
      graphStore: config.graphStore!,
      historyStore: config.historyStore!,
      llmInstance: config.llmInstance!,
      embedderInstance: config.embedderInstance!,
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
        // Mark old memory as not latest
        const oldPayload = await this.vectorStore.get(candidateMemory.id);
        if (oldPayload) {
          const updatedOld = {
            ...oldPayload.payload,
            isLatest: false,
            updatedAt: now(),
          };
          // Re-embed the old payload to update it
          const oldEmbedding = await this.embedder.embed(
            String(oldPayload.payload["memory"] ?? ""),
          );
          await this.vectorStore.update(candidateMemory.id, oldEmbedding, updatedOld);
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
    } catch {
      // Graph enrichment is best-effort — don't fail the add
    }
  }

  // ---------------------------------------------------------------------------
  // search()
  // ---------------------------------------------------------------------------

  async search(query: string, options: SearchOptions): Promise<MemoryItem[]> {
    const limit = options.limit ?? this.config.defaultTopK;
    const threshold = options.threshold ?? this.config.defaultThreshold;

    const queryEmbedding = await this.embedder.embed(query);
    const vectorResults = await this.vectorStore.search(queryEmbedding, limit * 2, {
      userId: options.userId,
    });

    let results = vectorResults
      .filter((r) => r.score >= threshold)
      .map((r) => this.payloadToMemory(r.id, r.payload, r.score));

    // Filter: only latest by default
    results = results.filter((m) => m.isLatest !== false);

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

    // Keyword search blend
    if (options.keywordSearch && this.vectorStore.keywordSearch) {
      const kwResults = await this.vectorStore.keywordSearch(query, limit, {
        userId: options.userId,
      });
      const kwMemories = kwResults.map((r) =>
        this.payloadToMemory(r.id, r.payload, r.score * 0.7),
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
    return this.payloadToMemory(result.id, result.payload, 1);
  }

  async getAll(options: GetAllOptions): Promise<MemoryItem[]> {
    const [results] = await this.vectorStore.list(
      { userId: options.userId },
      options.limit ?? 1000,
      options.offset ?? 0,
    );

    let memories = results.map((r) =>
      this.payloadToMemory(r.id, r.payload, 1),
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

  private payloadToMemory(
    id: string,
    payload: Record<string, unknown>,
    score: number,
  ): MemoryItem {
    const item: MemoryItem = {
      id,
      memory: String(payload["memory"] ?? ""),
      userId: String(payload["userId"] ?? ""),
      createdAt: String(payload["createdAt"] ?? new Date().toISOString()),
      updatedAt: String(payload["updatedAt"] ?? new Date().toISOString()),
      isLatest: payload["isLatest"] !== false,
      version: Number(payload["version"] ?? 1),
      hash: String(payload["hash"] ?? hashContent(String(payload["memory"] ?? ""))),
      score,
    };
    if (payload["category"] !== undefined) item.category = payload["category"] as string;
    if (payload["memoryType"] !== undefined) {
      const mt = payload["memoryType"] as string;
      if (mt === "fact" || mt === "preference" || mt === "episode") {
        item.memoryType = mt;
      }
    }
    if (payload["eventDate"] !== undefined) item.eventDate = payload["eventDate"] as string;
    if (payload["metadata"] !== undefined) item.metadata = payload["metadata"] as Record<string, unknown>;
    return item;
  }
}
