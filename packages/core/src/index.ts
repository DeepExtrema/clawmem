// ============================================================================
// @clawmem/core — Public API
// ============================================================================

// Main class
export { Memory } from "./memory.js";
export type { ClawMemConfig } from "./memory.js";

// Errors
export { ClawMemError, LLMError, EmbedderError, StorageError } from "./errors.js";

// Interfaces
export type {
  MemoryItem,
  MemoryType,
  MemoryCategory,
  ConversationMessage,
  AddOptions,
  AddResult,
  SearchOptions,
  GetAllOptions,
  UserProfile,
  VectorStore,
  VectorStoreConfig,
  VectorStoreResult,
  Embedder,
  EmbedderConfig,
  LLM,
  LLMConfig,
  LLMMessage,
  GraphStore,
  GraphStoreConfig,
  GraphRelation,
  Entity,
  HistoryStore,
  HistoryEntry,
} from "./interfaces/index.js";

export { MEMORY_CATEGORIES } from "./interfaces/index.js";

// Built-in backends (for advanced config)
export { SqliteVecStore } from "./backends/sqlite-vec.js";
export { KuzuGraphStore } from "./backends/kuzu.js";
export { SqliteHistoryStore } from "./backends/sqlite-history.js";
export { OpenAICompatLLM } from "./backends/openai-compat-llm.js";
export { OpenAICompatEmbedder } from "./backends/openai-compat-embedder.js";

// Utilities
export { hashContent, cosineSimilarity, now, parseDate } from "./utils/index.js";

// Sleep mode (nightly analysis)
export { SleepMode } from "./sleep.js";
export type { SleepModeConfig, SleepDigest, ConversationLogEntry } from "./sleep.js";

// Query rewriting
export { rewriteQuery, buildQueryRewritePrompt } from "./query-rewriting.js";

// Prompts (for customization)
export {
  buildExtractionPrompt,
  parseExtractionResponse,
  CATEGORY_DESCRIPTIONS,
} from "./prompts/extraction.js";
export { buildProfileSummary } from "./prompts/profile.js";
export { parseBullets } from "./utils/parse-bullets.js";
