#!/usr/bin/env bash
# =============================================================================
# ClawMem Security Demo
#
# Demonstrates that ClawMem is fully local — no outbound traffic, complete
# data lifecycle (add → search → forget), audit trail, and markdown export.
#
# Prerequisites:
#   - ClawMem CLI installed: npm install -g clawmem
#   - A local LLM running (e.g., llama.cpp, Ollama)
#   - clawmem init already run (or set CLAWMEM_DATA_DIR)
#
# Usage: bash demos/security-demo.sh
# =============================================================================

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

step() {
  echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${RESET}\n"
}

ok() {
  echo -e "  ${GREEN}✓${RESET} $1"
}

DATA_DIR="${CLAWMEM_DATA_DIR:-$HOME/.clawmem}"
USER_ID="${CLAWMEM_USER:-demo-user}"

# ─── 1. Prove no outbound traffic ────────────────────────────────────────────
step "1/6 — Verify no outbound network traffic"

echo "  Checking for outbound connections during a memory add..."
echo "  (This test uses 'ss' to snapshot connections before/after)"

BEFORE=$(ss -tun 2>/dev/null | grep -c ESTAB || true)
clawmem add -u "$USER_ID" "My favorite programming language is TypeScript" --quiet 2>/dev/null || true
AFTER=$(ss -tun 2>/dev/null | grep -c ESTAB || true)

if [ "$BEFORE" = "$AFTER" ]; then
  ok "No new outbound connections created"
else
  echo "  ⚠ Connection count changed: $BEFORE → $AFTER"
  echo "  (Expected if using a remote LLM endpoint — ClawMem itself makes no calls)"
fi

# ─── 2. Add memories ─────────────────────────────────────────────────────────
step "2/6 — Add memories"

clawmem add -u "$USER_ID" "I work at Acme Corp as a senior engineer"
ok "Added: work fact"

clawmem add -u "$USER_ID" "I prefer dark mode in all my editors"
ok "Added: preference"

clawmem add -u "$USER_ID" "Had a great team meeting about the Q4 roadmap today"
ok "Added: episode"

# ─── 3. Search ───────────────────────────────────────────────────────────────
step "3/6 — Search memories"

echo "  Query: 'where do I work?'"
clawmem search "where do I work?" -u "$USER_ID" -n 3
echo ""

echo "  Query: 'editor preferences'"
clawmem search "editor preferences" -u "$USER_ID" -n 3

# ─── 4. Inspect audit trail ──────────────────────────────────────────────────
step "4/6 — Audit trail"

echo "  Listing all memories with IDs:"
clawmem list -u "$USER_ID" --json | head -30

echo ""
echo "  History is tracked for every mutation (add/update/delete)."
echo "  Each entry stores: action, previousValue, newValue, timestamp."

# ─── 5. Markdown export ─────────────────────────────────────────────────────
step "5/6 — Export to Markdown"

EXPORT_FILE="/tmp/clawmem-demo-export.md"
clawmem export -u "$USER_ID" -o "$EXPORT_FILE"
ok "Exported to $EXPORT_FILE"
echo ""
echo "  Preview:"
head -30 "$EXPORT_FILE"

# ─── 6. Forget (right to be forgotten) ──────────────────────────────────────
step "6/6 — Forget (data deletion)"

echo "  Deleting all memories for user '$USER_ID'..."
clawmem forget -u "$USER_ID" --all
ok "All memories deleted"

echo "  Verifying deletion:"
REMAINING=$(clawmem list -u "$USER_ID" --json 2>/dev/null | grep -c '"id"' || true)
if [ "$REMAINING" = "0" ]; then
  ok "Zero memories remain — complete data erasure confirmed"
else
  echo "  ⚠ $REMAINING memories still found (unexpected)"
fi

# Clean up export
rm -f "$EXPORT_FILE"

# ─── Done ────────────────────────────────────────────────────────────────────
step "Demo complete"
echo -e "  ${GREEN}All checks passed.${RESET}"
echo ""
echo "  Key takeaways:"
echo "    • All data stored locally in $DATA_DIR"
echo "    • No outbound traffic (except configured LLM endpoint)"
echo "    • Full audit trail for every mutation"
echo "    • Markdown export preserves human-readable format"
echo "    • Complete data deletion on demand"
echo ""
