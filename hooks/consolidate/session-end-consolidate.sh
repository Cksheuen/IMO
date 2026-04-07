#!/bin/bash
# Session End Consolidation Trigger
# SessionEnd hook: increments session counter, triggers consolidation if threshold met.
#
# Consolidation runs in background (nohup) to avoid blocking session teardown.
# Trigger conditions (checked by consolidate.py):
#   - 24+ hours since last consolidation, OR
#   - 5+ sessions since last consolidation
#
# Note:
# - Codex feedback -> CC lessons no longer auto-runs here.
# - Use `/codex-feedback-review` to explicitly consume codex-feedback.jsonl incrementally.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONSOLIDATE="$SCRIPT_DIR/consolidate.py"
LOG="$HOME/.claude/consolidation.log"

# Increment session counter
python3 "$CONSOLIDATE" --increment-session 2>/dev/null

# Run consolidation check in background (non-blocking)
nohup python3 "$CONSOLIDATE" --target all >> "$LOG" 2>&1 &

# === CC ↔ Codex sync ===
CODEX_SYNC="$HOME/.claude/hooks/codex-sync/sync-to-codex.sh"
CODEX_SYNC_LOG="$HOME/.claude/shared-knowledge/sync.log"

# Sync CC rules → Codex AGENTS.md (background, non-blocking)
if [ -x "$CODEX_SYNC" ]; then
  nohup bash "$CODEX_SYNC" >> "$CODEX_SYNC_LOG" 2>&1 &
fi

exit 0
