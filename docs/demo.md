# ClawMem Demo Script

> Security-first demo: "no outbound traffic, audit log, forget works, group-safe"

## Setup

```bash
# 1. Start llama.cpp LLM server
./llama-server -m models/llama3.2-3b-q4.gguf --port 8080 --host 127.0.0.1

# 2. Start embedder
./llama-server -m models/nomic-embed-text-v1.5.gguf --port 8082 --host 127.0.0.1 --embedding

# 3. Initialize ClawMem
clawmem init --llm-url http://127.0.0.1:8080/v1 --embed-url http://127.0.0.1:8082/v1

# 4. Verify
clawmem doctor
```

---

## Demo 1: No outbound traffic

```bash
# Start network monitor
sudo tcpdump -i lo port 8080 -l &

# Add a memory — only loopback traffic
clawmem add "I prefer Neovim over VSCode for editing"

# Show: only 127.0.0.1 traffic (your local LLM)
# No calls to api.openai.com, api.mem0.ai, etc.
```

---

## Demo 2: Memories are extracted and searchable

```bash
clawmem add "I'm a TypeScript developer working on an OpenClaw memory plugin called ClawMem"

clawmem search "what am I building"
# → "The user is building an OpenClaw memory plugin called ClawMem"

clawmem search "programming language"
# → "The user is a TypeScript developer"

clawmem profile
# Shows structured profile: identity, technical, projects, ...
```

---

## Demo 3: Audit log and full history

```bash
clawmem add "I use Python for data analysis"
clawmem add "I switched from Python to Rust for performance work"

# The UPDATE chain: new fact supersedes old
clawmem list
# → "The user switched from Python to Rust..." (isLatest: true)
# → "The user uses Python..." (isLatest: false)

clawmem history <id-of-python-memory>
# Shows: ADD → superseded by UPDATE
```

---

## Demo 4: Forget works (and is auditable)

```bash
# Get a memory ID
clawmem list --json | jq '.[0].id'

# Delete it
clawmem forget <id>

# Verify it's gone
clawmem list
# → Memory is no longer in results

# But history is preserved
clawmem history <id>
# → Shows: ADD ... DELETE (complete audit trail)
```

---

## Demo 5: Group-chat safe

In your OpenClaw config:
```json
{ "skipGroupChats": true }
```

```bash
# In a group chat context: memory is NOT captured
# In a 1:1 context: memory IS captured
# Demonstrated by checking the memory count before/after each type of chat
openclaw clawmem status
```

---

## Demo 6: OpenClaw auto-recall in action

After setting up the plugin:
1. Tell OpenClaw: *"I prefer TypeScript and use Neovim"*
2. Start a new conversation about coding
3. OpenClaw automatically has the context: `<relevant-memories>` injected
4. Ask: *"What editor should I use for this project?"* → agent recommends Neovim based on stored preference

---

## Demo 7: Export and inspect

```bash
clawmem export --output ~/memories

ls ~/memories/
# 2026-02-18.md  MEMORY.md

cat ~/memories/MEMORY.md
# Human-readable summary of all memories
# Complete transparency: you can see exactly what's stored
```
