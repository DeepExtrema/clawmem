# ClawMem Quickstart

> Local-first AI memory — durable, auditable, reversible.

## Requirements

- Node.js 20+
- A running LLM server (llama.cpp, Ollama, LM Studio, or OpenAI API)
- A running embedder server (llama.cpp with a nomic-embed model, or any OpenAI-compat endpoint)

## Install

```bash
# One-command install
curl -fsSL https://raw.githubusercontent.com/tekron/clawmem/main/install.sh | bash

# Or manually
npm install -g clawmem
```

## Initialize

```bash
# Point ClawMem at your local LLM and embedder
clawmem init \
  --llm-url http://127.0.0.1:8080/v1 \
  --embed-url http://127.0.0.1:8082/v1 \
  --llm-model llama3.2 \
  --embed-model nomic-embed-text

# Verify your setup
clawmem doctor
```

## Use the CLI

```bash
# Add memories from a text snippet (LLM extracts facts)
clawmem add "I use TypeScript for all my backend work and prefer Zod for validation"

# Search semantically
clawmem search "programming language preference"

# List all memories
clawmem list

# Show user profile
clawmem profile

# Export to markdown
clawmem export --output ~/Documents/memories

# Import from markdown
clawmem import ~/Documents/memories/2026-02-18.md

# Delete a specific memory
clawmem forget <id>

# Show full audit history for a memory
clawmem history <id>

# Check for expired memories (requires forgettingRules in config)
clawmem retention
clawmem retention --delete  # actually delete them
```

## Install as OpenClaw Memory Plugin

```bash
# Install the plugin
openclaw plugins install @clawmem/openclaw

# Set as your memory slot in ~/.openclaw/config.json
```

```json
{
  "plugins": {
    "slots": {
      "memory": "@clawmem/openclaw"
    },
    "@clawmem/openclaw": {
      "llm": { "baseURL": "http://127.0.0.1:8080/v1", "model": "llama3.2" },
      "embedder": { "baseURL": "http://127.0.0.1:8082/v1", "model": "nomic-embed-text" },
      "autoRecall": true,
      "autoCapture": true,
      "enableGraph": true
    }
  }
}
```

Then use within OpenClaw:

```
> memory_search "what do I prefer for backend work"
> memory_store "I'm building a memory plugin for OpenClaw"
> memory_profile
> openclaw clawmem status
> openclaw clawmem export --output ./memory
```

## Typical llama.cpp setup (local)

```bash
# Terminal 1: LLM server (e.g. llama3.2 3B)
./llama-server -m models/llama3.2-3b-q4.gguf --port 8080 --host 127.0.0.1

# Terminal 2: Embedder server (nomic-embed-text)
./llama-server -m models/nomic-embed-text-v1.5.gguf \
  --port 8082 --host 127.0.0.1 --embedding

# Terminal 3: Start using ClawMem
clawmem add "I prefer Neovim over VSCode"
clawmem search "editor preference"
```

## What gets stored

ClawMem extracts durable, self-contained facts from your conversations:

| Input | Extracted memory |
|-------|-----------------|
| `"I'm a TypeScript dev working on an OpenClaw plugin"` | `"The user is a TypeScript developer"`, `"The user is building an OpenClaw plugin"` |
| `"I switched from Python to Rust last month"` | `"The user switched from Python to Rust"` *(supersedes any Python preference)* |
| `"My GPU is an AMD RX 6750 XT"` | `"The user has an AMD RX 6750 XT GPU"` *(category: infrastructure)* |

## Next steps

- [Configuration Reference](./config-reference.md)
- [Architecture](./architecture.md)
- [Security Model](./security-model.md)
- [API Reference](./api-reference.md)
