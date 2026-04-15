#!/bin/bash
# Resume Task - restores a suspended Claude Code session after rate limit reset

STATE_DIR="$HOME/.claude"
SUSPENDED_FILE="$STATE_DIR/suspended-task.json"
RESUME_PID_FILE="$STATE_DIR/.resume-pid"
TMP_SCRIPT=""

cleanup() {
  [ -n "$TMP_SCRIPT" ] && rm -f "$TMP_SCRIPT"
}

trap cleanup EXIT

# Clean up PID file
rm -f "$RESUME_PID_FILE"

# Check if there's a task to resume
if [ ! -f "$SUSPENDED_FILE" ]; then
  echo "[$(date)] No suspended task found" >> "$STATE_DIR/rate-limit.log"
  exit 0
fi

# Read suspended task context
SESSION_ID=$(jq -r '.session_id // empty' "$SUSPENDED_FILE")
CWD=$(jq -r '.cwd // empty' "$SUSPENDED_FILE")
RESUME_PROMPT=$(jq -r '.resume_prompt // "Continue the previous task."' "$SUSPENDED_FILE")

# Verify rate limit has actually reset by checking state file
if [ -f "$STATE_DIR/rate-limit-state.json" ]; then
  CURRENT_PCT=$(jq -r '.five_hour_pct // 0' "$STATE_DIR/rate-limit-state.json" 2>/dev/null)
  PCT_INT=$(printf "%.0f" "$CURRENT_PCT" 2>/dev/null || echo 0)
  if [ "$PCT_INT" -ge 95 ] 2>/dev/null; then
    # Still rate limited, retry in 5 minutes
    echo "[$(date)] Still rate limited (${PCT_INT}%), retrying in 5 min" >> "$STATE_DIR/rate-limit.log"
    nohup bash -c 'sleep "$1"; exec "$2"' _ 300 "$0" > /dev/null 2>&1 &
    echo "$!" > "$RESUME_PID_FILE"
    exit 0
  fi
fi

# Archive suspended task
mv "$SUSPENDED_FILE" "$SUSPENDED_FILE.$(date +%s).bak" 2>/dev/null

# Desktop notification
osascript -e "display notification \"Resuming session: ${SESSION_ID}\" with title \"Claude Code Resuming\"" 2>/dev/null

# Log
echo "[$(date)] Resuming session=$SESSION_ID in cwd=$CWD" >> "$STATE_DIR/rate-limit.log"

# Resume the session
# Use --resume with session ID for precision, with -p for the resume prompt
if [ -n "$SESSION_ID" ] && [ -n "$CWD" ]; then
  cd "$CWD" 2>/dev/null || true

  TMP_SCRIPT=$(mktemp "${TMPDIR:-/tmp}/claude-resume.XXXXXX.sh")
  chmod 700 "$TMP_SCRIPT"
  {
    printf '#!/bin/bash\n'
    printf 'cd %q || exit 1\n' "$CWD"
    printf 'exec claude --resume %q -p %q\n' "$SESSION_ID" "$RESUME_PROMPT"
  } > "$TMP_SCRIPT"

  # Open a new terminal window with the resumed session
  osascript <<EOF
tell application "Terminal"
  activate
  do script "bash $TMP_SCRIPT"
end tell
EOF

else
  echo "[$(date)] ERROR: Missing session_id or cwd, cannot resume" >> "$STATE_DIR/rate-limit.log"
  osascript -e "display notification \"Cannot auto-resume: missing session info. Run 'claude -c' manually.\" with title \"Claude Code Resume Failed\"" 2>/dev/null
fi
