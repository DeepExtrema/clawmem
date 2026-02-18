import type { LLM, Embedder, MemoryItem, VectorStore } from "./interfaces/index.js";
import { cosineSimilarity } from "./utils/index.js";
import { payloadToMemory } from "./utils/conversion.js";
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

  // Step 1: Hash check — O(1) indexed lookup
  const hashMatch = await vectorStore.findByHash(
    newMemory.hash,
    newMemory.userId,
  );
  if (hashMatch) {
    return {
      decision: {
        action: "skip",
        targetId: hashMatch.id,
        reason: "Exact duplicate (hash match)",
      },
      candidateMemory: payloadToMemory(hashMatch.id, hashMatch.payload, hashMatch.score),
    };
  }

  // Step 2: Semantic search for similar memories
  const similar = await vectorStore.search(
    newMemory.embedding,
    maxCandidates,
    { userId: newMemory.userId, isLatest: true },
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

  // #54: Index-to-id fallback — if LLM returned a numeric index instead of an ID
  let resolvedTargetId = parsed.targetId;
  if (resolvedTargetId) {
    const matchById = candidates.find((c) => c.id === resolvedTargetId);
    if (!matchById) {
      const idx = parseInt(resolvedTargetId, 10);
      if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
        const candidateAtIndex = candidates[idx];
        if (candidateAtIndex) {
          resolvedTargetId = candidateAtIndex.id;
        }
      }
    }
  }

  const matchingCandidate = resolvedTargetId
    ? candidates.find((c) => c.id === resolvedTargetId)
    : undefined;

  return {
    decision: { ...parsed, targetId: resolvedTargetId ?? parsed.targetId },
    ...(matchingCandidate && {
      candidateMemory: payloadToMemory(
        matchingCandidate.id,
        matchingCandidate.payload,
        matchingCandidate.score,
      ),
    }),
  };
}
