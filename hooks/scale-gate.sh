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
# Exit codes: 0 = allow, 2 = block with feedback

set -u

INPUT=$(cat)

# Extract fields - use python3 as fallback if jq unavailable
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
else
  TOOL_NAME=$(printf '%s' "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)
  SESSION_ID=$(printf '%s' "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null)
fi

# Only gate Edit and Write
case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

# Need session_id to track state
if [ -z "$SESSION_ID" ]; then
  exit 0
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
  exit 0
fi

# Cleanup old markers (> 24h) to prevent accumulation
if [ -d "$STATE_DIR" ]; then
  find "$STATE_DIR" -type f -mtime +1 -delete 2>/dev/null
fi

# Block and remind
mkdir -p "$STATE_DIR"
cat >&2 <<EOF
Scale assessment required before editing files.

Task bootstrap:
- Current task directory: ${TASK_DIR:-<bootstrap failed>}
- Seeded files: prd.md, context.md, status.md, feature-list.json

Evaluate task scope first:
- How many files will be modified?
- How many lines of code?
- How many domains (frontend/backend/tests/etc)?

Then decide:
- Trivial/Simple (1-2 files) → mark done and proceed directly
- Moderate/Complex (3+ files or 2+ domains) → use orchestrate skill to decompose

Mark assessment done by running:
  touch $MARKER
EOF
exit 2
