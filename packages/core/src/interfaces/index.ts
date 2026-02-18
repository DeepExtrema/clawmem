// ============================================================================
// Core Interfaces for ClawMem pluggable backends
// ============================================================================

// ---------------------------------------------------------------------------
// Memory items
// ---------------------------------------------------------------------------

export interface MemoryItem {
  id: string;
  memory: string;
  userId: string;
  category?: string;
  memoryType?: MemoryType;
  /** When the memory was stored */
  createdAt: string;
  /** Last time this memory was updated */
  updatedAt: string;
  /** Relevance score (0-1), set during search */
  score?: number;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
  /** Whether this is the latest version (false if superseded by UPDATE) */
  isLatest: boolean;
  /** Version number, incremented on update */
  version: number;
  /** Date the event/fact occurred (if extractable), ISO 8601 */
  eventDate?: string;
  /** Hash of the memory content for dedup */
  hash: string;
}

export type MemoryType = "fact" | "preference" | "episode";

export const MEMORY_CATEGORIES = [
  "identity",
  "preferences",
  "goals",
  "technical",
  "infrastructure",
  "projects",
  "relationships",
  "life_events",
  "health",
  "finance",
  "assistant",
  "knowledge",
  "other",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Add / Search / GetAll options
// ---------------------------------------------------------------------------

export interface AddOptions {
  userId: string;
  runId?: string;
  categories?: MemoryCategory[];
  customInstructions?: string;
  enableGraph?: boolean;
}

export interface SearchOptions {
  userId: string;
  limit?: number;
  threshold?: number;
  category?: MemoryCategory;
  memoryType?: MemoryType;
  /** Enable keyword search (FTS5) in addition to vector search */
  keywordSearch?: boolean;
  /** Start of time range filter (ISO 8601) */
  fromDate?: string;
  /** End of time range filter (ISO 8601) */
  toDate?: string;
  runId?: string;
}

export interface GetAllOptions {
  userId: string;
  runId?: string;
  category?: MemoryCategory;
  memoryType?: MemoryType;
  limit?: number;
  offset?: number;
  onlyLatest?: boolean;
}

export interface AddResult {
  added: MemoryItem[];
  updated: MemoryItem[];
  deduplicated: number;
  graphRelations?: GraphRelation[];
}

// ---------------------------------------------------------------------------
// Vector Store interface
// ---------------------------------------------------------------------------

export interface VectorStoreConfig {
  dimension?: number;
  [key: string]: unknown;
}

export interface VectorStoreResult {
  id: string;
  payload: Record<string, unknown>;
  score: number;
}

export interface VectorStore {
  /** Insert vectors with their payloads */
  insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, unknown>[],
  ): Promise<void>;

  /** Search by vector similarity */
  search(
    query: number[],
    limit: number,
    filters?: Record<string, unknown>,
  ): Promise<VectorStoreResult[]>;

  /** Keyword (FTS) search */
  keywordSearch?(
    query: string,
    limit: number,
    filters?: Record<string, unknown>,
  ): Promise<VectorStoreResult[]>;

  /** Delete by ID */
  delete(id: string): Promise<void>;

  /** Get by ID */
  get(id: string): Promise<VectorStoreResult | null>;

  /** List all, with optional filters */
  list(
    filters?: Record<string, unknown>,
    limit?: number,
    offset?: number,
  ): Promise<[VectorStoreResult[], number]>;

  /** Update payload for existing vector */
  update(
    id: string,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void>;

  /** Delete all entries matching filters */
  deleteAll(filters?: Record<string, unknown>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Embedder interface
// ---------------------------------------------------------------------------

export interface EmbedderConfig {
  baseURL: string;
  apiKey?: string;
  model?: string;
  dimension?: number;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimension: number;
}

// ---------------------------------------------------------------------------
// LLM interface
// ---------------------------------------------------------------------------

export interface LLMConfig {
  baseURL: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLM {
  complete(messages: LLMMessage[], opts?: { json?: boolean }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Graph Store interface
// ---------------------------------------------------------------------------

export interface Entity {
  id: string;
  name: string;
  type: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type RelationshipType = "UPDATES" | "EXTENDS" | "DERIVES" | "RELATES_TO" | "ABOUT";

export interface GraphRelation {
  sourceId: string;
  sourceName: string;
  relationship: string;
  targetId: string;
  targetName: string;
  confidence?: number;
  createdAt: string;
}

export interface GraphStoreConfig {
  dbPath: string;
  [key: string]: unknown;
}

export interface GraphStore {
  /** Add entities and their relationships */
  addEntities(
    entities: Omit<Entity, "id" | "createdAt" | "updatedAt">[],
    relations: Omit<GraphRelation, "createdAt">[],
  ): Promise<void>;

  /** Search for related facts/entities by query text */
  search(
    query: string,
    userId: string,
    limit?: number,
  ): Promise<GraphRelation[]>;

  /** Get all relationships for a user */
  getAll(userId: string): Promise<GraphRelation[]>;

  /** Get neighbors of a named entity */
  getNeighbors(entityName: string, userId: string): Promise<GraphRelation[]>;

  /** Create an UPDATE chain between two memories (new supersedes old) */
  createUpdate(
    newMemoryId: string,
    oldMemoryId: string,
    reason: string,
  ): Promise<void>;

  /** Create an EXTEND relationship (new adds detail to old) */
  createExtend(newMemoryId: string, oldMemoryId: string): Promise<void>;

  /** Delete all graph data for a user */
  deleteAll(userId: string): Promise<void>;

  /** Close the database connection */
  close(): void;
}

// ---------------------------------------------------------------------------
// History Store interface
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  memoryId: string;
  action: "add" | "update" | "delete";
  previousValue: string | null;
  newValue: string | null;
  userId: string;
  createdAt: string;
}

export interface HistoryStore {
  add(entry: Omit<HistoryEntry, "id" | "createdAt">): Promise<void>;
  getHistory(memoryId: string): Promise<HistoryEntry[]>;
  reset(userId?: string): Promise<void>;
  close(): void;
}

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

export interface UserProfile {
  userId: string;
  static: {
    identity: MemoryItem[];
    preferences: MemoryItem[];
    technical: MemoryItem[];
    relationships: MemoryItem[];
  };
  dynamic: {
    goals: MemoryItem[];
    projects: MemoryItem[];
    lifeEvents: MemoryItem[];
  };
  other: MemoryItem[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Conversation message (input to add())
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
