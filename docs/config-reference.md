# ClawMem Configuration Reference

## Config file location

`~/.clawmem/config.json`

Run `clawmem init` to generate the default config, or create it manually.

---

## Full config schema

```json
{
  "dataDir": "~/.clawmem",
  "userId": "default",
  "llm": {
    "baseURL": "http://127.0.0.1:8080/v1",
    "model": "llama3.2",
    "apiKey": "local"
  },
  "embedder": {
    "baseURL": "http://127.0.0.1:8082/v1",
    "model": "nomic-embed-text",
    "dimension": 768
  },
  "enableGraph": true,
  "dedupThreshold": 0.85,
  "defaultTopK": 5,
  "forgettingRules": {
    "episode": 30,
    "preference": 0,
    "fact": 0
  }
}
```

---

## Fields

### `dataDir` (string)
Path to the directory where ClawMem stores its databases.

- Default: `~/.clawmem`
- Contains: `vector.db` (SQLite), `history.db` (SQLite), `kuzu/` (graph DB)

### `userId` (string)
Default user ID for memory scoping.

- Default: `"default"`
- Override per-command with `--user <id>`

### `llm.baseURL` (string, required)
OpenAI-compatible LLM endpoint. Used for memory extraction and deduplication decisions.

- Examples: `http://127.0.0.1:8080/v1` (llama.cpp), `http://localhost:11434/v1` (Ollama), `https://api.openai.com/v1`

### `llm.model` (string)
Model name to pass in the API request.

### `llm.apiKey` (string)
API key. Use `"local"` for local servers, or your actual key for cloud providers.

### `embedder.baseURL` (string, required)
OpenAI-compatible embedder endpoint.

### `embedder.model` (string)
Embedding model name.

- Recommended: `nomic-embed-text` (768d), `mxbai-embed-large` (1024d)

### `embedder.dimension` (number)
Embedding dimension. Must match your model.

- Default: `768`

### `enableGraph` (boolean)
Enable Kùzu embedded graph memory (entity relationships, UPDATE chains).

- Default: `true`
- Set to `false` for faster startup / lower memory usage

### `dedupThreshold` (number, 0-1)
Cosine similarity threshold above which two memories are considered duplicates and the LLM decides whether to update, extend, or skip.

- Default: `0.85`
- Lower = more aggressive deduplication

### `defaultTopK` (number)
Default number of search results.

- Default: `10`

### `forgettingRules` (object)
Automatic memory expiry by type. Value is retention days. `0` = never expire.

```json
{
  "episode": 30,
  "preference": 0,
  "fact": 0
}
```

- `episode: 30` → episodes older than 30 days are flagged by `clawmem retention`
- Run `clawmem retention --delete` to clean up expired memories

---

## OpenClaw plugin config

Add to `~/.openclaw/config.json`:

```json
{
  "plugins": {
    "slots": { "memory": "@clawmem/openclaw" },
    "@clawmem/openclaw": {
      "dataDir": "~/.clawmem",
      "userId": "default",
      "autoRecall": true,
      "autoCapture": true,
      "skipGroupChats": true,
      "searchThreshold": 0.3,
      "topK": 5,
      "enableGraph": true,
      "llm": { "baseURL": "http://127.0.0.1:8080/v1" },
      "embedder": { "baseURL": "http://127.0.0.1:8082/v1" }
    }
  }
}
```

### Plugin-specific fields

#### `autoRecall` (boolean, default: true)
Inject relevant memories into context before each agent turn.

#### `autoCapture` (boolean, default: true)
Extract and store facts from conversations after each agent turn.

#### `skipGroupChats` (boolean, default: true)
Skip memory capture/recall in group chats.

#### `searchThreshold` (number, 0-1, default: 0.3)
Minimum similarity score for auto-recall. Lower = more memories injected.

#### `identityMapPath` (string)
Path to a JSON file mapping channel-specific user IDs to canonical user IDs.

```json
{
  "users": {
    "canonical-user-id": {
      "aliases": ["telegram:12345", "discord:67890"]
    }
  }
}
```
