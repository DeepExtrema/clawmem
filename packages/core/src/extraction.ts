import { randomUUID } from "crypto";
import type { LLM, Embedder, MemoryItem, ConversationMessage, AddOptions } from "./interfaces/index.js";
import {
  buildExtractionPrompt,
  parseExtractionResponse,
} from "./prompts/extraction.js";
import { hashContent, now } from "./utils/index.js";

/**
 * Extraction pipeline: takes a conversation and returns extracted MemoryItems.
 * Does NOT persist — just extracts. Dedup and storage happen in Memory class.
 */
export async function extractMemories(
  messages: ConversationMessage[],
  llm: LLM,
  embedder: Embedder,
  options: AddOptions,
): Promise<Array<MemoryItem & { embedding: number[] }>> {
  const systemPrompt = buildExtractionPrompt(options.customInstructions);

  // Serialize conversation for LLM
  const conversationText = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const raw = await llm.complete(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Extract memories from this conversation:\n\n${conversationText}`,
      },
    ],
    { json: true },
  );

  const extracted = parseExtractionResponse(raw);
  if (extracted.length === 0) return [];

  // Generate embeddings for all extracted memories in one batch
  const texts = extracted.map((e) => e.memory);
  const embeddings = await embedder.embedBatch(texts);

  const ts = now();
  return extracted.map((e, i) => ({
    id: randomUUID(),
    memory: e.memory,
    userId: options.userId,
    category: e.category,
    memoryType: e.memoryType,
    createdAt: ts,
    updatedAt: ts,
    isLatest: true,
    version: 1,
    ...(e.eventDate != null && { eventDate: e.eventDate }),
    hash: hashContent(e.memory),
    embedding: embeddings[i] ?? [],
    metadata: {},
  }));
}
