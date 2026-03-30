#!/bin/bash
# Session End Consolidation Trigger
# SessionEnd hook: increments session counter, triggers consolidation if threshold met.
#
# Consolidation runs in background (nohup) to avoid blocking session teardown.
# Trigger conditions (checked by consolidate.py):
#   - 24+ hours since last consolidation, OR
#   - 5+ sessions since last consolidation

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONSOLIDATE="$SCRIPT_DIR/consolidate.py"
LOG="$HOME/.claude/consolidation.log"

# Increment session counter
python3 "$CONSOLIDATE" --increment-session 2>/dev/null

# Run consolidation check in background (non-blocking)
nohup python3 "$CONSOLIDATE" --target all >> "$LOG" 2>&1 &

exit 0
