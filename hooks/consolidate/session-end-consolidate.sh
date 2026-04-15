#!/bin/bash
# Session End Consolidation Trigger
# SessionEnd hook: increments session counter, triggers consolidation if threshold met.
#
# Consolidation runs in background (nohup) to avoid blocking session teardown.
# Trigger conditions (checked by consolidate.py):
#   - 24+ hours since last consolidation, OR
#   - 5+ sessions since last consolidation

set -u

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // .sessionId // ""')
export METRICS_SESSION_ID="$SESSION_ID"
export METRICS_SCOPE="global"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONSOLIDATE="$SCRIPT_DIR/consolidate.py"
LOG="$HOME/.claude/consolidation.log"
STATE_FILE="$HOME/.claude/consolidation-state.json"
METRICS_LIB="$HOME/.claude/hooks/metrics/emit.sh"
METRICS_STATUS="ok"
METRICS_META_JSON=""

if [ -f "$METRICS_LIB" ]; then
  # shellcheck disable=SC1090
  . "$METRICS_LIB"
fi

metrics_start_ms=0
if command -v metrics_now_ms >/dev/null 2>&1; then
  metrics_start_ms=$(metrics_now_ms)
fi

metrics_finalize() {
  local exit_code=$?
  local duration_ms=""

  if [ "$exit_code" -ne 0 ]; then
    METRICS_STATUS="error"
  fi

  if command -v metrics_now_ms >/dev/null 2>&1 && [ "${metrics_start_ms:-0}" -gt 0 ] 2>/dev/null; then
    duration_ms=$(( $(metrics_now_ms) - metrics_start_ms ))
  fi

  if command -v metrics_emit >/dev/null 2>&1; then
    metrics_emit "session-end-consolidate" "SessionEnd" "session_boundary" "$METRICS_STATUS" "$duration_ms" "$METRICS_META_JSON"
  fi
}

trap metrics_finalize EXIT

# Increment session counter
python3 "$CONSOLIDATE" --increment-session 2>/dev/null

if [ -f "$STATE_FILE" ]; then
  session_count=$(python3 - "$STATE_FILE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)

value = payload.get("session_count", "")
print(value if isinstance(value, int) else "")
PY
  )
  if [ -n "$session_count" ]; then
    METRICS_META_JSON=$(jq -cn --argjson session_count "$session_count" '{session_count:$session_count}' 2>/dev/null || printf '')
  fi
fi

# Run consolidation check in background (non-blocking)
nohup python3 "$CONSOLIDATE" --target all >> "$LOG" 2>&1 &

# === CC ↔ Codex sync ===
CODEX_SYNC="$HOME/.claude/hooks/codex-sync/sync-to-codex.sh"
CODEX_FEEDBACK="$HOME/.claude/hooks/codex-sync/process-codex-feedback.py"
CODEX_SYNC_LOG="$HOME/.claude/shared-knowledge/sync.log"

# Sync CC rules → Codex AGENTS.md (background, non-blocking)
if [ -x "$CODEX_SYNC" ]; then
  nohup bash "$CODEX_SYNC" >> "$CODEX_SYNC_LOG" 2>&1 &
fi

# Process Codex feedback → CC lessons (background, non-blocking)
if [ -f "$CODEX_FEEDBACK" ]; then
  MANIFEST="$HOME/.claude/shared-knowledge/sync-manifest.json"
  nohup python3 "$CODEX_FEEDBACK" \
    --apply \
    --min-occurrences 2 \
    --update-manifest "$MANIFEST" \
    >> "$CODEX_SYNC_LOG" 2>&1 &
fi

exit 0
