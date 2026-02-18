---
"@clawmem/core": minor
"@clawmem/openclaw": minor
"clawmem": minor
---

Initial release — v0.1.0

## @clawmem/core

- Memory engine: add, search, update, delete, getAll with full audit history
- Extraction: LLM-powered fact extraction (13 categories, 3 memory types)
- Deduplication: hash + semantic + LLM merge with UPDATE/EXTEND/DERIVE chains
- Graph memory: Kùzu-backed entity/relationship extraction and recall
- User profiles: static (identity, preferences, technical) + dynamic (goals, projects)
- Sleep mode: nightly conversation analysis and consolidation
- Hybrid search: vector (sqlite-vec ANN) + FTS5 keyword search
- Temporal filtering: fromDate/toDate search constraints
- Retention scanner: automatic forgetting with configurable per-type rules
- Markdown sync: two-lane export/import preserving Markdown as source of truth
- Query rewriting: LLM-powered query expansion for short/ambiguous queries
- Typed errors: ClawMemError, LLMError, EmbedderError, StorageError
- 123+ unit tests covering all subsystems

## @clawmem/openclaw

- OpenClaw memory-slot plugin (plugins.slots.memory)
- 7 tools: memory_search, memory_store, memory_store_raw, memory_list, memory_get, memory_forget, memory_profile
- Auto-recall hook: injects relevant memories before each agent turn
- Auto-capture hook: extracts facts after each conversation
- Group-chat safety: auto-skips capture in group contexts
- Identity mapping: multi-channel user resolution
- Slash commands: /memory search, list, forget, profile, export, import, doctor

## clawmem (CLI)

- Commands: init, add, search, forget, profile, export, import, history, sleep, doctor
- Config management: ~/.clawmem/config.json
- Works with any OpenAI-compatible LLM and embedder endpoint
