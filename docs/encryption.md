# Encryption at Rest

ClawMem stores all data locally in SQLite databases. For sensitive deployments,
you can enable encryption at rest using [SQLCipher](https://www.zetetic.net/sqlcipher/).

> **Status:** Config field available (`encryption.passphrase`). Runtime
> implementation is planned for a future release. This document describes the
> intended architecture and how to prepare.

## How It Will Work

When `encryption.passphrase` is set in the config:

1. **SQLite databases** (`vector.db`, `history.db`) will be opened with
   `PRAGMA key = '<passphrase>'` via SQLCipher.
2. **Kùzu graph database** does not support SQLCipher directly. Graph data will
   be encrypted at the filesystem level (e.g., LUKS, FileVault, BitLocker) or
   via a future Kùzu encryption layer.
3. **MEMORY.md** (markdown export) is plaintext by design — it's the
   human-readable source of truth. Encrypt at the filesystem level if needed.

## Config

```typescript
import { Memory } from "@clawmem/core";

const mem = new Memory({
  dataDir: "./data",
  llm: { baseURL: "http://localhost:8080/v1" },
  embedder: { baseURL: "http://localhost:8080/v1" },
  encryption: {
    passphrase: process.env.CLAWMEM_PASSPHRASE!,
  },
});
```

## Prerequisites

SQLCipher requires a custom build of `better-sqlite3`:

```bash
# Install SQLCipher development libraries
# macOS
brew install sqlcipher

# Ubuntu/Debian
sudo apt-get install libsqlcipher-dev

# Build better-sqlite3 with SQLCipher
npm install better-sqlite3 --build-from-source \
  --sqlite3=/usr/local \
  --sqlite3_column_metadata=yes \
  --sqlite3_fts5=yes \
  --sqlite3_json1=yes \
  --sqlite3_rtree=yes \
  --sqlite3_session=yes \
  --sqlcipher=yes
```

## Security Considerations

| Layer | Protection | Notes |
|-------|-----------|-------|
| SQLCipher | AES-256-CBC | Encrypts `.db` files at rest |
| Filesystem encryption | Full-disk | Covers Kùzu, MEMORY.md, temp files |
| Memory | None | Data is plaintext in RAM while running |
| Network | N/A | ClawMem is local-only; no network calls except to configured LLM/embedder endpoints |

### Passphrase Management

- **Never hardcode** the passphrase in config files
- Use environment variables: `process.env.CLAWMEM_PASSPHRASE`
- Consider OS keychain integration for desktop deployments
- Rotate passphrases by re-encrypting: `sqlcipher_export('plaintext')` → re-open with new key

## Current Workaround

Until native SQLCipher support ships, you can:

1. **Use filesystem encryption** (LUKS, FileVault, BitLocker)
2. **Set restrictive permissions** on the data directory:
   ```bash
   chmod 700 ~/.clawmem
   ```
3. **Use a tmpfs/ramfs** mount for ephemeral data that shouldn't persist on disk

## Roadmap

- [ ] Wire `encryption.passphrase` into `better-sqlite3` constructor
- [ ] Add `clawmem doctor` check for SQLCipher availability
- [ ] Key rotation support via `clawmem rekey` command
- [ ] Investigate Kùzu encryption support
