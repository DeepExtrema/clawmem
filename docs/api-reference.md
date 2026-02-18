# ClawMem API Reference

## `@clawmem/core` — Memory class

```typescript
import { Memory } from "@clawmem/core";

const mem = new Memory({
  dataDir: "~/.clawmem",
  llm: { baseURL: "http://127.0.0.1:8080/v1", model: "llama3.2" },
  embedder: { baseURL: "http://127.0.0.1:8082/v1", model: "nomic-embed-text", dimension: 768 },
  enableGraph: true,
});
```

---

### `mem.add(messages, options)`

Extract facts from a conversation and store them.

```typescript
const result = await mem.add(
  [{ role: "user", content: "I prefer TypeScript over Python" }],
  { userId: "alice" }
);
// result: { added: MemoryItem[], updated: MemoryItem[], deduplicated: number }
```

**Options:**
- `userId: string` — required
- `customInstructions?: string` — extra rules for the LLM extractor
- `enableGraph?: boolean` — override graph for this call

---

### `mem.search(query, options)`

Semantic search over memories.

```typescript
const results = await mem.search("programming language preference", {
  userId: "alice",
  limit: 5,
  threshold: 0.3,           // min similarity score
  category: "technical",    // filter by category
  memoryType: "preference", // filter by type
  keywordSearch: true,      // enable FTS5 hybrid search
  fromDate: "2026-01-01",   // date range filter
  toDate: "2026-12-31",
});
// results: MemoryItem[] sorted by score descending
```

---

### `mem.get(id)`

Get a single memory by ID.

```typescript
const memory = await mem.get("abc123");
```

---

### `mem.getAll(options)`

List memories with filtering.

```typescript
const memories = await mem.getAll({
  userId: "alice",
  category: "technical",
  memoryType: "fact",
  limit: 50,
  offset: 0,
  onlyLatest: true,  // exclude superseded versions (default: true)
});
```

---

### `mem.update(id, newText)`

Manually update a memory's text. Increments version, records in history.

```typescript
const updated = await mem.update("abc123", "The user is 26 years old.");
// updated.version === 2
```

---

### `mem.delete(id)`

Delete a single memory. Recorded in history.

```typescript
await mem.delete("abc123");
```

---

### `mem.deleteAll(userId)`

Delete all memories for a user (including graph + history).

```typescript
await mem.deleteAll("alice");
```

---

### `mem.profile(userId)`

Generate a structured user profile from all stored memories.

```typescript
const profile = await mem.profile("alice");
// {
//   userId: "alice",
//   static: { identity: [...], preferences: [...], technical: [...], relationships: [...] },
//   dynamic: { goals: [...], projects: [...], lifeEvents: [...] },
//   other: [...],
//   generatedAt: "2026-02-18T..."
// }
```

---

### `mem.history(memoryId)`

Get full version history for a memory.

```typescript
const hist = await mem.history("abc123");
// [ { action: "add", newValue: "...", createdAt: "..." },
//   { action: "update", previousValue: "...", newValue: "...", createdAt: "..." } ]
```

---

### `mem.graphRelations(userId)`

Get all graph relationships for a user's memories.

```typescript
const relations = await mem.graphRelations("alice");
```

---

### `mem.retentionScanner(userId, opts)`

Find and optionally delete expired memories based on `forgettingRules` config.

```typescript
const { expired, deleted } = await mem.retentionScanner("alice", {
  autoDelete: false, // dry run by default
});
```

---

### `mem.exportMarkdown(userId, outputDir, opts)`

Export memories to markdown files.

```typescript
const files = await mem.exportMarkdown("alice", "./memories", {
  onlyLatest: true,
});
// Writes: ./memories/2026-02-18.md, ./memories/MEMORY.md
```

---

### `mem.importMarkdown(filePath, userId, opts)`

Import bullet points from a markdown file as memories.

```typescript
const result = await mem.importMarkdown("./memories/notes.md", "alice");
// result: { added: 5, updated: 1, skipped: 2 }
```

---

## Types

```typescript
interface MemoryItem {
  id: string;
  memory: string;
  userId: string;
  category?: MemoryCategory;  // one of 13 categories
  memoryType?: "fact" | "preference" | "episode";
  createdAt: string;          // ISO 8601
  updatedAt: string;
  score?: number;             // 0-1, set during search
  isLatest: boolean;          // false if superseded by UPDATE
  version: number;            // increments on update
  eventDate?: string;         // when the event happened (if extractable)
  hash: string;               // content hash for dedup
  metadata?: Record<string, unknown>;
}

type MemoryCategory =
  | "identity" | "preferences" | "goals" | "technical"
  | "infrastructure" | "projects" | "relationships" | "life_events"
  | "health" | "finance" | "assistant" | "knowledge" | "other";
```

---

## OpenClaw Plugin Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search over stored memories |
| `memory_store` | Extract and store facts from text |
| `memory_store_raw` | Store exact text verbatim |
| `memory_list` | List all memories |
| `memory_get` | Get memory by ID |
| `memory_forget` | Delete memory (or all) |
| `memory_profile` | Generate structured user profile |

## OpenClaw Plugin CLI

```bash
openclaw clawmem search <query>  # search memories
openclaw clawmem status          # show statistics
openclaw clawmem wipe            # delete all memories (with confirmation)
openclaw clawmem profile         # show user profile
openclaw clawmem export          # export to markdown
openclaw clawmem import <file>   # import from markdown
```

## Standalone CLI

```bash
clawmem init            # initialize config
clawmem add <text>      # extract and add memories
clawmem search <query>  # semantic search
clawmem list            # list all memories
clawmem forget <id>     # delete a memory
clawmem forget all      # wipe all memories
clawmem profile         # show user profile
clawmem history <id>    # show version history
clawmem export          # export to markdown
clawmem import <file>   # import from markdown
clawmem retention       # scan for expired memories
clawmem doctor          # health check
```
