import { createHash } from "crypto";

/** Hash a string to a short hex id (first 16 chars of sha256) */
export function hashContent(content: string): string {
  return createHash("sha256")
    .update(content.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Current ISO 8601 timestamp */
export function now(): string {
  return new Date().toISOString();
}

/** Parse an ISO 8601 date string, returns null if invalid */
export function parseDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Sleep for ms milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
