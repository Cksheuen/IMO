#!/bin/bash
# Scale Assessment Gate - PreToolUse hook
# Blocks first Edit/Write in a session until task scale has been assessed.
# It also bootstraps a task directory for the session before implementation.
#
# Flow:
#   1. First Edit/Write → bootstrap task directory, then block with reminder
#   2. Claude assesses (reads files, estimates scope, decides delegation strategy)
#   3. Claude marks assessment done: touch ~/.claude/.scale-gate/{session_id}
#   4. Subsequent Edit/Write → pass through
#
# Contract: return Claude Code hook JSON instead of relying on stderr/exit 2.

set -u

INPUT=$(cat)

# Extract fields - use python3 as fallback if jq unavailable
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // .toolName // empty')
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // .sessionId // empty')
else
  TOOL_NAME=$(printf '%s' "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name') or d.get('toolName') or '')" 2>/dev/null)
  SESSION_ID=$(printf '%s' "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id') or d.get('sessionId') or '')" 2>/dev/null)
fi

export METRICS_SESSION_ID="$SESSION_ID"
export METRICS_SCOPE="global"

METRICS_LIB="$HOME/.claude/hooks/metrics/emit.sh"
if [ -f "$METRICS_LIB" ]; then
  # shellcheck disable=SC1090
  . "$METRICS_LIB"
fi

metrics_start_ms=0
if command -v metrics_now_ms >/dev/null 2>&1; then
  metrics_start_ms=$(metrics_now_ms)
fi

emit_gate_result() {
  local status="$1"
  local reason="${2:-}"
  local duration_ms=""
  local meta_json=""

  if command -v metrics_now_ms >/dev/null 2>&1 && [ "${metrics_start_ms:-0}" -gt 0 ] 2>/dev/null; then
    duration_ms=$(( $(metrics_now_ms) - metrics_start_ms ))
  fi

  if [ -n "$reason" ]; then
    if command -v jq >/dev/null 2>&1; then
      meta_json=$(jq -cn --arg reason "$reason" '{reason:$reason}' 2>/dev/null || printf '')
    else
      meta_json=$(python3 - "$reason" <<'PY'
import json
import sys
print(json.dumps({"reason": sys.argv[1]}, ensure_ascii=False))
PY
      )
    fi
  fi

  if command -v metrics_emit >/dev/null 2>&1; then
    metrics_emit "scale-gate" "PreToolUse" "gate_decision" "$status" "$duration_ms" "$meta_json"
  fi
}

print_decision_json() {
  local decision="$1"
  local reason="${2:-}"

  if [ -n "$reason" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -cn --arg decision "$decision" --arg reason "$reason" '{decision:$decision,reason:$reason}'
    else
      python3 - "$decision" "$reason" <<'PY'
import json
import sys
print(json.dumps({"decision": sys.argv[1], "reason": sys.argv[2]}, ensure_ascii=False))
PY
    fi
  else
    if command -v jq >/dev/null 2>&1; then
      jq -cn --arg decision "$decision" '{decision:$decision}'
    else
      python3 - "$decision" <<'PY'
import json
import sys
print(json.dumps({"decision": sys.argv[1]}, ensure_ascii=False))
PY
    fi
  fi
}

allow() {
  local reason="${1:-}"
  emit_gate_result "allowed" "$reason"
  print_decision_json "allow" "$reason"
  exit 0
}

deny() {
  local output_reason="$1"
  local metrics_reason="${2:-$1}"
  emit_gate_result "blocked" "$metrics_reason"
  print_decision_json "deny" "$output_reason"
  exit 0
}

# Only gate Edit and Write
case "$TOOL_NAME" in
  Edit|Write) ;;
  *) allow ;;
esac

# Need session_id to track state
if [ -z "$SESSION_ID" ]; then
  allow "missing_session_id"
fi

STATE_DIR="$HOME/.claude/.scale-gate"
MARKER="$STATE_DIR/$SESSION_ID"
BOOTSTRAP_SCRIPT="$HOME/.claude/hooks/task-bootstrap.sh"

TASK_DIR=""
if [ -x "$BOOTSTRAP_SCRIPT" ]; then
  TASK_DIR=$(printf '%s' "$INPUT" | "$BOOTSTRAP_SCRIPT" 2>/dev/null || true)
fi

# If already assessed this session, pass through
if [ -f "$MARKER" ]; then
  allow "scale_assessment_already_done"
fi

# Cleanup old markers (> 24h) to prevent accumulation
if [ -d "$STATE_DIR" ]; then
  find "$STATE_DIR" -type f -mtime +1 -delete 2>/dev/null
fi

# Block and remind
mkdir -p "$STATE_DIR"
touch "$MARKER"
deny "$(python3 - "$MARKER" "$TASK_DIR" <<'PYEOF'
import sys

marker, task_dir = sys.argv[1:3]
reason = f"""Scale assessment required before editing files.

Task bootstrap:
- Current task directory: {task_dir or '<bootstrap failed>'}
- Seeded files: prd.md, context.md, status.md, feature-list.json

Evaluate task scope first:
- How many files will be modified?
- How many lines of code?
- How many domains (frontend/backend/tests/etc)?

Then decide:
- Trivial/Simple (1-2 files) → mark done and proceed directly
- Moderate/Complex (3+ files or 2+ domains) → use orchestrate skill to decompose
- 3+ independent subtasks → prefer Agent Teams / parallel subagents

Mark assessment done by running:
  touch {marker}
"""
print(reason)
PYEOF
)" "Scale assessment required before editing files"
