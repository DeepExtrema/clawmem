import type { MemoryItem } from "../interfaces/index.js";
import { hashContent } from "./index.js";

/** Convert a flat payload record (from VectorStore) into a typed MemoryItem */
export function payloadToMemory(
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
    hash: String(
      payload["hash"] ?? hashContent(String(payload["memory"] ?? "")),
    ),
    score,
  };
  if (payload["category"] !== undefined)
    item.category = payload["category"] as string;
  if (payload["memoryType"] !== undefined) {
    const mt = payload["memoryType"] as string;
    if (mt === "fact" || mt === "preference" || mt === "episode") {
      item.memoryType = mt;
    }
  }
  if (payload["eventDate"] !== undefined)
    item.eventDate = payload["eventDate"] as string;
  if (payload["metadata"] !== undefined)
    item.metadata = payload["metadata"] as Record<string, unknown>;
  return item;
}
