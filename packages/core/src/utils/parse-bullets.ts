/**
 * Extract bullet points from markdown content.
 * Supports MEMORY.md (no IDs) and date files (with IDs).
 */
export function parseBullets(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.match(/^[-*]\s+(.+)/))
    .map((line) =>
      line
        .replace(/^[-*]\s+/, "")
        .replace(/\s*<!--\s*id:[^>]*-->\s*$/, "") // strip <!-- id:... -->
        .replace(/\s*\*\(.*?\)\*\s*$/, "") // strip *(type)*
        .trim(),
    )
    .filter((line) => line.length > 5);
}
