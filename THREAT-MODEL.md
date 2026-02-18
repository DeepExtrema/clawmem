# ClawMem Threat Model

> Version: 0.1 | Last updated: 2026-02-18

This document describes what ClawMem stores, where, who can access it, and what the risks are.

---

## What data ClawMem stores

| Data | Where | Format | Encrypted by default |
|------|-------|--------|----------------------|
| Extracted memory facts | `~/.clawmem/vector.db` (sqlite-vec) | SQLite rows + float32 vectors | ❌ (plaintext) |
| Entity relationships | `~/.clawmem/graph.kuzu/` | Kùzu binary files | ❌ (plaintext) |
| Mutation history | `~/.clawmem/history.db` | SQLite rows | ❌ (plaintext) |
| Conversation logs (sleep mode) | Configurable path | JSONL | ❌ (plaintext) |
| Identity map | Configurable path | JSON config | ❌ (plaintext) |

**Encryption at rest**: Optional via SQLCipher (documented in config reference). Not enabled by default.

---

## Network access

**By default: zero outbound calls.**

ClawMem makes network calls only when you configure an endpoint:

| Config | What it calls | When |
|--------|---------------|------|
| `llm.baseURL` | Your LLM endpoint | During memory extraction (add) |
| `embedder.baseURL` | Your embedder endpoint | During add + search |

Both default to `http://127.0.0.1` (local). If you point them at a remote service (e.g., `api.openai.com`), your conversation content and memories will be sent to that service.

**Group chats**: auto-skipped. No memories captured from group conversations.

---

## Trust boundaries

```
┌─ Your machine ──────────────────────────────┐
│                                              │
│  ClawMem ──→ sqlite-vec (local file)        │
│  ClawMem ──→ Kùzu (local directory)         │
│  ClawMem ──→ LLM endpoint (127.0.0.1:8080) │  ← configurable
│  ClawMem ──→ Embedder (127.0.0.1:8082)     │  ← configurable
│                                              │
└──────────────────────────────────────────────┘
         ↕ only if you configure a remote endpoint
┌─ Remote service ─┐
│  OpenAI / etc.   │
└──────────────────┘
```

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Memory DB readable by other local processes | Medium | High (personal data) | Run as dedicated user; optional encryption |
| Remote LLM endpoint receives conversation content | Low (default local) | High | Default to localhost; audit your baseURL config |
| Memory injection attack (malicious content stored) | Low | Medium | Hard caps on memory count and token size |
| Stale/incorrect memories affecting agent behavior | Medium | Medium | Audit log + revert command; configurable thresholds |
| Sensitive data persisted from group chats | Low | High | Group chat skip enabled by default |

---

## What ClawMem does NOT do

- Does **not** phone home, send telemetry, or check for updates automatically
- Does **not** access files outside its configured data directory
- Does **not** execute arbitrary code from memory content
- Does **not** make network calls without a configured remote endpoint

---

## Audit log

Every memory mutation produces an immutable history entry:

```json
{
  "memoryId": "...",
  "action": "add|update|delete",
  "previousValue": "...",
  "newValue": "...",
  "timestamp": "2026-02-18T...",
  "userId": "..."
}
```

Use `clawmem history <id>` to inspect. Use `clawmem revert <id> <version>` to restore.
