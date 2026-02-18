# ClawMem Architecture

## Overview

ClawMem is a **local-first memory engine** designed as a native OpenClaw memory-slot plugin and standalone CLI.

```
┌──────────────────────────────────────────────────────────────┐
│                   OpenClaw Agent                             │
│   (any platform: desktop, mobile, Telegram, Discord, API)   │
└──────────────────────┬───────────────────────────────────────┘
                       │ memory-slot plugin
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                @clawmem/openclaw plugin                      │
│                                                              │
│  7 tools: search, store, store_raw, list, get, forget, profile│
│  Auto-recall: before_agent_start → inject <relevant-memories>│
│  Auto-capture: agent_end → extract facts from conversation   │
│  Identity mapping: channel ID → canonical user ID           │
│  Markdown sync: export/import ↔ workspace memory/ folder    │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  @clawmem/core (Memory class)                │
│                                                              │
│  add()        → extract → dedup → store → graph             │
│  search()     → embed query → ANN search + FTS5 → rerank    │
│  profile()    → categorize all memories → structured object  │
│  retentionScanner() → find/delete expired memories          │
│  exportMarkdown()   → memories → YYYY-MM-DD.md files        │
│  importMarkdown()   → markdown bullets → memories           │
└──────┬──────────────┬───────────────────┬───────────────────┘
       │              │                   │
       ▼              ▼                   ▼
┌──────────┐  ┌──────────────┐  ┌─────────────────┐
│ sqlite-  │  │ Kùzu graph   │  │  SQLite history  │
│ vec.db   │  │ (embedded)   │  │  (audit log)     │
│ (vectors │  │ Entities,    │  │  every change    │
│ + FTS5)  │  │ Relationships│  │  recorded        │
└──────────┘  └──────────────┘  └─────────────────┘
       │
       ▼
OpenAI-compat API (LLM + Embedder)
→ llama.cpp / Ollama / LM Studio / OpenAI
```

## Two-Lane Memory Model

```
Lane 1: Workspace Markdown (canonical, human-readable)
  memory/YYYY-MM-DD.md   ← append-only daily log
  memory/MEMORY.md       ← curated long-term summary

Lane 2: Vector+Graph Store (durable, searchable)
  vector.db              ← SQLite + FTS5 + cosine similarity
  kuzu/                  ← Kùzu embedded graph (entity relationships)
  history.db             ← complete audit log

clawmem export → Lane 2 → Lane 1 (regenerate markdown from store)
clawmem import → Lane 1 → Lane 2 (extract from markdown into store)
```

## Memory Lifecycle

```
User input (conversation)
    │
    ▼
Extraction (LLM)
    "What facts in this conversation are worth remembering?"
    → 13 categories (identity, technical, infrastructure, ...)
    → 3 types (fact, preference, episode)
    → eventDate (when did this happen?)
    │
    ▼
Deduplication
    1. Hash check (exact duplicate → skip immediately)
    2. Semantic similarity (cosine > threshold)
       → same idea but different words? Ask LLM
    3. LLM decision: add | update | extend | skip
    │
    ├─── add:    Store new memory
    ├─── update: Create new version, mark old isLatest=false
    │            (UPDATE chain in graph: new→old)
    ├─── extend: Store alongside (EXTENDS chain in graph)
    └─── skip:   Discard (exact duplicate)
    │
    ▼
Storage
    Vector DB: embedding + payload (JSON)
    FTS5:      full-text index for keyword search
    Graph:     entity extraction → nodes + relationships
    History:   audit log entry (action, previous, new value, timestamp)
```

## Graph Memory (Kùzu)

```cypher
-- Entity nodes (people, tech, projects, etc.)
Entity { id, name, type, userId, createdAt }

-- Memory nodes
Memory { id, content, category, memoryType, isLatest, version, userId }

-- Typed relationships
RELATES_TO: Entity → Entity (relationship: "uses", "prefers", "works_on")
UPDATES:    Memory → Memory (new supersedes old)
EXTENDS:    Memory → Memory (new supplements old)
ABOUT:      Memory → Entity (memory references entity)
```

## Memory Type Scoring

Search results are scored by memory type:

| Type | Score multiplier | Rationale |
|------|-----------------|-----------|
| `fact` | ×1.0 | Neutral |
| `preference` | ×1.1 | Slight boost (stable, user-specific) |
| `episode` | ×(1.0 - decay) | Decays over 100 days (max 30% penalty) |

## Database Files

| File | Contents | Format |
|------|----------|--------|
| `~/.clawmem/vector.db` | Embeddings, memory payloads, FTS5 index | SQLite 3 |
| `~/.clawmem/history.db` | Full audit log | SQLite 3 |
| `~/.clawmem/kuzu/` | Entity graph | Kùzu embedded graph |
| `~/.clawmem/config.json` | Runtime config | JSON |

All data is local by default. No outbound network calls unless you configure a remote LLM/embedder endpoint.
