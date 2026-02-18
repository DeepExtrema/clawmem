# ClawMem

> Local-first memory engine for OpenClaw — durable, auditable, reversible.

**"Markdown stays the source of truth, but recall is persistent, searchable, and graph-aware."**

[![CI](https://github.com/DeepExtrema/clawmem/actions/workflows/ci.yml/badge.svg)](https://github.com/DeepExtrema/clawmem/actions/workflows/ci.yml)
[![npm @clawmem/core](https://img.shields.io/npm/v/@clawmem/core)](https://www.npmjs.com/package/@clawmem/core)
[![npm @clawmem/openclaw](https://img.shields.io/npm/v/@clawmem/openclaw)](https://www.npmjs.com/package/@clawmem/openclaw)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Tests: 130+](https://img.shields.io/badge/tests-130%2B-brightgreen)](packages/core/tests/)

---

## What is ClawMem?

ClawMem is a **standalone, open-source alternative to SuperMemory** — locally hostable, zero-server, and designed as a native memory-slot plugin for [OpenClaw](https://openclaw.ai).

### Why ClawMem over Supermemory or Mem0?

| Feature | Supermemory | Mem0 OSS | ClawMem |
|---------|-------------|----------|---------|
| Graph memory (UPDATE/EXTEND/DERIVE) | ✅ Neo4j required | ✅ Neo4j required | ✅ **Kùzu embedded** (zero ops) |
| Vector search | ✅ | ✅ | ✅ sqlite-vec |
| Hybrid search (vector + keyword) | ✅ | ❌ | ✅ FTS5 + vector |
| User profiles (static + dynamic) | ✅ | ❌ | ✅ |
| Contradiction resolution | ✅ | Partial | ✅ Graph UPDATE chains |
| Temporal reasoning | ✅ | ❌ | ✅ |
| Local-first (no cloud required) | ❌ | ✅ | ✅ |
| Zero-server (fully embedded) | ❌ | ❌ | ✅ |
| Markdown two-lane sync | ❌ | ❌ | ✅ |
| Reversible (full audit log) | ❌ | ❌ | ✅ |
| OpenClaw memory-slot plugin | ✅ | ✅ | ✅ **Native** |

---

## Quick Start

### As an OpenClaw plugin (30 seconds)

```bash
openclaw plugins install @clawmem/openclaw
```

Add to your OpenClaw config:

```json
{
  "plugins": {
    "slots": {
      "memory": "@clawmem/openclaw"
    }
  }
}
```

Configure ClawMem (point to your local LLM + embedder):

```json
{
  "clawmem": {
    "llm": { "baseURL": "http://127.0.0.1:8080/v1", "model": "deepseek-r1" },
    "embedder": { "baseURL": "http://127.0.0.1:8082/v1", "model": "nomic-embed-text" }
  }
}
```

### Standalone CLI

```bash
npm install -g clawmem
clawmem init
clawmem add "I prefer TypeScript over Python"
clawmem search "programming preferences"
clawmem profile
```

---

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@clawmem/core`](packages/core/) | Core memory engine (extraction, vector+graph, dedup, profiles) | `npm i @clawmem/core` |
| [`@clawmem/openclaw`](packages/openclaw-plugin/) | OpenClaw memory-slot plugin | `openclaw plugins install @clawmem/openclaw` |
| [`clawmem`](packages/cli/) | Standalone CLI | `npm i -g clawmem` |

---

## Storage Backends

| Layer | Default | Alternatives |
|-------|---------|-------------|
| Vector store | **sqlite-vec** | LanceDB, Qdrant |
| Graph store | **Kùzu** (embedded) | Neo4j |
| History | **SQLite** | — |
| LLM | OpenAI-compatible | Any |
| Embedder | OpenAI-compatible | Any |

All defaults are **embedded** — no servers, no Docker, no accounts.

---

## Safety by Default

- **No outbound calls** unless you explicitly configure a remote endpoint
- **Full audit log**: every memory mutation records previous value + diff
- **Reversible**: `clawmem history <id>` shows version chain, `clawmem revert <id> <version>` restores
- **Group-safe**: auto-skips capture in OpenClaw group chats
- **Hard caps**: configurable max memories, tokens, retention days

See [THREAT-MODEL.md](THREAT-MODEL.md) for the full security model.

---

## Architecture

```
packages/core          @clawmem/core
  ├─ Memory engine     add / search / get / getAll / delete / update
  ├─ Extraction        LLM → structured facts (13 categories)
  ├─ Deduplication     hash + semantic + LLM merge
  ├─ Graph memory      Kùzu: entities, relationships, UPDATE/EXTEND/DERIVE
  ├─ User profiles     static (identity/prefs) + dynamic (projects/goals)
  ├─ Sleep mode        nightly consolidation + digest
  └─ Pluggable backends

packages/openclaw-plugin   @clawmem/openclaw
  ├─ Memory-slot plugin    plugins.slots.memory
  ├─ 7 tools               search, store, store_raw, list, get, forget, profile
  ├─ Auto-recall           injects memories before each agent turn
  ├─ Auto-capture          extracts facts after each agent turn
  ├─ Markdown sync         two-lane: workspace .md ↔ vector+graph store
  └─ Identity mapping      multi-channel user resolution

packages/cli               clawmem
  └─ Standalone CLI        init, add, search, forget, profile, graph, sleep, doctor
```

---

## Development

```bash
# Prerequisites: Node 20+, pnpm 9+
git clone https://github.com/DeepExtrema/clawmem
cd clawmem
pnpm install
pnpm build
pnpm test          # 130+ tests across core, CLI, and plugin
```

### Optional: Enable ANN vector search

```bash
# Install sqlite-vec for fast approximate nearest neighbor search
# Without it, ClawMem falls back to O(n) cosine similarity (fine for <10k memories)
pnpm add sqlite-vec --filter @clawmem/core
```

### Error Types

ClawMem exports typed errors for structured error handling:

```typescript
import { ClawMemError, LLMError, EmbedderError, StorageError } from "@clawmem/core";

try {
  await memory.add(messages, { userId: "user1" });
} catch (err) {
  if (err instanceof LLMError) {
    // LLM timeout, HTTP error, or empty response
  } else if (err instanceof EmbedderError) {
    // Embedding dimension mismatch, timeout, or HTTP error
  } else if (err instanceof StorageError) {
    // Database error
  }
}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [docs/](docs/) for full API reference.

---

## License

[Apache 2.0](LICENSE) © 2026 DeepExtrema
