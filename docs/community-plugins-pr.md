# ClawMem — Community Plugins PR

**Plugin name:** ClawMem  
**npm:** [`@clawmem/openclaw`](https://www.npmjs.com/package/@clawmem/openclaw)  
**GitHub:** [DeepExtrema/clawmem](https://github.com/DeepExtrema/clawmem)  
**License:** Apache 2.0

## What it is

ClawMem is a **local-first memory-slot plugin** for OpenClaw.

> "Local-first memory slot plugin for OpenClaw: Markdown stays the source of truth, but recall is durable, auditable, and reversible."

## Install

```bash
openclaw plugins install @clawmem/openclaw
```

## Config

```json
{
  "plugins": {
    "slots": { "memory": "@clawmem/openclaw" },
    "@clawmem/openclaw": {
      "llm": { "baseURL": "http://127.0.0.1:8080/v1" },
      "embedder": { "baseURL": "http://127.0.0.1:8082/v1" }
    }
  }
}
```

## Features

- **7 tools**: `memory_search`, `memory_store`, `memory_store_raw`, `memory_list`, `memory_get`, `memory_forget`, `memory_profile`
- **Auto-recall**: Injects relevant memories before each agent turn
- **Auto-capture**: Extracts facts from conversations automatically
- **Graph memory**: Entity relationships via embedded Kùzu (no server required)
- **13 memory categories**: identity, technical, infrastructure, preferences, goals, projects, ...
- **Full audit log**: Every change tracked, full history queryable
- **Contradiction resolution**: UPDATE chains with `isLatest` versioning
- **Markdown sync**: Two-lane model — memories ↔ `memory/YYYY-MM-DD.md`
- **Group-chat safe**: Skips capture/recall in group contexts
- **Zero server deps**: SQLite + Kùzu embedded, works offline

## Safety

- Local-first: no outbound calls unless you configure a remote LLM
- Auditable: `openclaw clawmem export` generates human-readable markdown
- Reversible: `memory_forget` with full history
- Group-safe: `skipGroupChats: true` by default

## Links

- Quickstart: https://github.com/DeepExtrema/clawmem/blob/main/docs/quickstart.md
- Config reference: https://github.com/DeepExtrema/clawmem/blob/main/docs/config-reference.md
- Architecture: https://github.com/DeepExtrema/clawmem/blob/main/docs/architecture.md
- Security model: https://github.com/DeepExtrema/clawmem/blob/main/THREAT-MODEL.md
- Issues: https://github.com/DeepExtrema/clawmem/issues
