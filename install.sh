#!/usr/bin/env bash
# ClawMem — One-command install script
# Usage: curl -fsSL https://raw.githubusercontent.com/tekron/clawmem/main/install.sh | bash
#    or: bash install.sh [--no-openclaw] [--data-dir DIR] [--llm-url URL] [--embed-url URL]

set -euo pipefail

CLAWMEM_VERSION="latest"
DATA_DIR="${HOME}/.clawmem"
LLM_URL="http://127.0.0.1:8080/v1"
EMBED_URL="http://127.0.0.1:8082/v1"
INSTALL_OPENCLAW_PLUGIN=true

# ─── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-openclaw)   INSTALL_OPENCLAW_PLUGIN=false; shift;;
    --data-dir)      DATA_DIR="$2"; shift 2;;
    --llm-url)       LLM_URL="$2"; shift 2;;
    --embed-url)     EMBED_URL="$2"; shift 2;;
    --version)       CLAWMEM_VERSION="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[clawmem]${NC} $*"; }
warn()    { echo -e "${YELLOW}[clawmem]${NC} $*"; }
die()     { echo -e "${RED}[clawmem] ERROR${NC} $*"; exit 1; }

# ─── Prerequisites ────────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v node  >/dev/null 2>&1 || die "Node.js is required. Install via https://nodejs.org (v20+)"
command -v npm   >/dev/null 2>&1 || die "npm is required."

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  die "Node.js 20+ required (found v${NODE_MAJOR}). Upgrade: https://nodejs.org"
fi

info "Node $(node --version) ✓"

# ─── Install clawmem CLI ─────────────────────────────────────────────────────
info "Installing clawmem CLI..."
if [[ "$CLAWMEM_VERSION" == "latest" ]]; then
  npm install -g clawmem 2>/dev/null || \
    die "npm install failed. Try: sudo npm install -g clawmem"
else
  npm install -g "clawmem@${CLAWMEM_VERSION}" 2>/dev/null || \
    die "npm install failed."
fi
info "clawmem CLI installed ✓"

# ─── Initialize config ───────────────────────────────────────────────────────
info "Initializing ClawMem config in ${DATA_DIR}..."
mkdir -p "${DATA_DIR}"
clawmem init \
  --data-dir "${DATA_DIR}" \
  --llm-url  "${LLM_URL}"  \
  --embed-url "${EMBED_URL}"

# ─── Install OpenClaw plugin (optional) ──────────────────────────────────────
if [[ "$INSTALL_OPENCLAW_PLUGIN" == "true" ]]; then
  if command -v openclaw >/dev/null 2>&1; then
    info "Installing @clawmem/openclaw plugin..."
    openclaw plugins install @clawmem/openclaw 2>/dev/null && \
      info "@clawmem/openclaw plugin installed ✓" || \
      warn "OpenClaw plugin install failed. Install manually: openclaw plugins install @clawmem/openclaw"

    info ""
    info "Add to your OpenClaw config (~/.openclaw/config.json):"
    echo '  "plugins": { "slots": { "memory": "@clawmem/openclaw" } }'
  else
    warn "OpenClaw not found — skipping plugin install."
    info "Install OpenClaw first: https://docs.openclaw.ai"
    info "Then install the plugin: openclaw plugins install @clawmem/openclaw"
  fi
fi

# ─── Doctor check ────────────────────────────────────────────────────────────
info ""
info "Running health check..."
clawmem doctor 2>/dev/null || warn "Some checks failed — see above. Run \`clawmem doctor\` after starting your LLM."

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ClawMem installed successfully!                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Data dir:  ${DATA_DIR}"
echo "  LLM:       ${LLM_URL}"
echo "  Embedder:  ${EMBED_URL}"
echo ""
echo "  Quick start:"
echo "    clawmem add 'I prefer TypeScript over Python'"
echo "    clawmem search 'programming language'"
echo "    clawmem profile"
echo "    clawmem doctor"
echo ""
echo "  Docs: https://github.com/tekron/clawmem"
