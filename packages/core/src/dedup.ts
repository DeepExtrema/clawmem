import type { LLM, Embedder, MemoryItem, VectorStore } from "./interfaces/index.js";
import { cosineSimilarity, hashContent } from "./utils/index.js";
import {
  buildDeduplicationPrompt,
  parseDeduplicationResponse,
  type DeduplicationDecision,
} from "./prompts/contradiction.js";

export interface DedupConfig {
  /** Cosine similarity threshold above which to call LLM for decision (default 0.85) */
  semanticThreshold?: number;
  /** Max number of existing memories to compare against (default 20) */
  maxCandidates?: number;
}

export interface DedupResult {
  decision: DeduplicationDecision;
  candidateMemory?: MemoryItem;
}

/**
 * Deduplicate a new memory against existing ones.
 *
 * Steps:
 * 1. Hash check — exact duplicate? → skip immediately
 * 2. Semantic similarity — find candidates above threshold
 * 3. LLM decision — for each candidate, ask LLM: add/update/skip/extend?
 */
export async function deduplicate(
  newMemory: MemoryItem & { embedding: number[] },
  vectorStore: VectorStore,
  embedder: Embedder,
  llm: LLM,
  config: DedupConfig = {},
): Promise<DedupResult> {
  const threshold = config.semanticThreshold ?? 0.85;
  const maxCandidates = config.maxCandidates ?? 20;

  // Step 1: Hash check
  const existing = await vectorStore.list(
    { userId: newMemory.userId },
    maxCandidates,
    0,
  );

  const hashMatch = existing[0].find(
    (r) => (r.payload["hash"] as string) === newMemory.hash,
  );
  if (hashMatch) {
    return {
      decision: {
        action: "skip",
        targetId: hashMatch.id,
        reason: "Exact duplicate (hash match)",
      },
      candidateMemory: vectorStoreResultToMemoryItem(hashMatch),
    };
  }

  // Step 2: Semantic search for similar memories
  const similar = await vectorStore.search(
    newMemory.embedding,
    maxCandidates,
    { userId: newMemory.userId },
  );

  const candidates = similar
    .filter((r) => r.score >= threshold)
    .slice(0, 5); // limit LLM calls

  if (candidates.length === 0) {
    return {
      decision: { action: "add", targetId: null, reason: "No similar memories found" },
    };
  }

  // Step 3: LLM decision
  const decision = await llm.complete(
    [
      {
        role: "user",
        content: buildDeduplicationPrompt(
          newMemory.memory,
          candidates.map((c) => ({
            id: c.id,
            memory: String(c.payload["memory"] ?? ""),
          })),
        ),
      },
    ],
    { json: true },
  );

  const parsed = parseDeduplicationResponse(decision);
  if (!parsed) {
    return {
      decision: { action: "add", targetId: null, reason: "Failed to parse LLM decision" },
    };
  }

  const matchingCandidate = parsed.targetId
    ? candidates.find((c) => c.id === parsed.targetId)
    : undefined;

  return {
    decision: parsed,
    ...(matchingCandidate && { candidateMemory: vectorStoreResultToMemoryItem(matchingCandidate) }),
  };
}

function vectorStoreResultToMemoryItem(
  r: { id: string; payload: Record<string, unknown>; score: number },
): MemoryItem {
  return {
    id: r.id,
    memory: String(r.payload["memory"] ?? ""),
    userId: String(r.payload["userId"] ?? ""),
    ...(r.payload["category"] !== undefined && { category: r.payload["category"] as string }),
    memoryType: (r.payload["memoryType"] as MemoryItem["memoryType"]) ?? "fact",
    createdAt: String(r.payload["createdAt"] ?? new Date().toISOString()),
    updatedAt: String(r.payload["updatedAt"] ?? new Date().toISOString()),
    isLatest: Boolean(r.payload["isLatest"] ?? true),
    version: Number(r.payload["version"] ?? 1),
    ...(r.payload["eventDate"] !== undefined && { eventDate: r.payload["eventDate"] as string }),
    hash: String(r.payload["hash"] ?? hashContent(String(r.payload["memory"] ?? ""))),
    score: r.score,
    ...(r.payload["metadata"] !== undefined && { metadata: r.payload["metadata"] as Record<string, unknown> }),
  };
}
