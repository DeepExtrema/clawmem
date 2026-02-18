# Contributing to ClawMem

Thank you for your interest in contributing!

## Development Setup

```bash
# Prerequisites
node >= 20
pnpm >= 9

# Clone and install
git clone https://github.com/DeepExtrema/clawmem
cd clawmem
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Typecheck
pnpm typecheck
```

## Project Structure

```
packages/
  core/              @clawmem/core — memory engine
  openclaw-plugin/   @clawmem/openclaw — OpenClaw plugin
  cli/               clawmem — standalone CLI
```

## Contribution Guidelines

- All code is TypeScript, ESM-first, Node 20+
- Run `pnpm typecheck && pnpm test` before opening a PR
- Write tests for new functionality
- Keep PRs focused — one feature or fix per PR
- Follow existing code style (no linter config yet — use judgment)

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets).

```bash
pnpm changeset       # describe your change
pnpm version         # bump versions
pnpm release         # build + publish
```

## Security

If you find a security issue, please see [SECURITY.md](SECURITY.md). Do **not** open a public issue.

## Code of Conduct

Be respectful. We're building something useful together.
