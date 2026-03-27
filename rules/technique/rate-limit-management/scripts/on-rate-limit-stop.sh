#!/bin/bash
# StopFailure Hook - captures task context and schedules resume on rate limit
# Receives JSON via stdin with: session_id, transcript_path, cwd, error, error_details

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$HOME/.claude"
SUSPENDED_FILE="$STATE_DIR/suspended-task.json"
RATE_STATE_FILE="$STATE_DIR/rate-limit-state.json"
RESUME_SCRIPT="$SCRIPT_DIR/resume-task.sh"
RESUME_PID_FILE="$STATE_DIR/.resume-pid"

INPUT=$(cat)

# Only handle rate limit errors
ERROR=$(echo "$INPUT" | jq -r '.error // empty')
ERROR_DETAILS=$(echo "$INPUT" | jq -r '.error_details // empty')

case "$ERROR$ERROR_DETAILS" in
  *rate_limit*|*Rate*limit*|*429*|*Too*Many*) ;;
  *) exit 0 ;;  # Not a rate limit error, ignore
esac

# Extract session info
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Determine reset time from state file (written by rate-limit-monitor)
RESETS_AT=0
if [ -f "$RATE_STATE_FILE" ]; then
  RESETS_AT=$(jq -r '.resets_at // 0' "$RATE_STATE_FILE" 2>/dev/null)
fi

# Fallback: if no reset time, default to 5 hours from now
NOW=$(date +%s)
if [ "$RESETS_AT" -le "$NOW" ] 2>/dev/null; then
  RESETS_AT=$((NOW + 18000))
fi

# Save suspended task context with proper JSON escaping
jq -n \
  --arg session_id "$SESSION_ID" \
  --arg transcript_path "$TRANSCRIPT_PATH" \
  --arg cwd "$CWD" \
  --arg error "$ERROR" \
  --arg error_details "$ERROR_DETAILS" \
  --arg resume_prompt "The previous session was interrupted by a rate limit. Continue the task from where it left off." \
  --argjson suspended_at "$NOW" \
  --argjson resets_at "$RESETS_AT" \
  '{
    session_id: $session_id,
    transcript_path: $transcript_path,
    cwd: $cwd,
    error: $error,
    error_details: $error_details,
    suspended_at: $suspended_at,
    resets_at: $resets_at,
    resume_prompt: $resume_prompt
  }' > "$SUSPENDED_FILE"

# Kill any existing resume waiter
if [ -f "$RESUME_PID_FILE" ]; then
  OLD_PID=$(cat "$RESUME_PID_FILE" 2>/dev/null)
  kill "$OLD_PID" 2>/dev/null
  rm -f "$RESUME_PID_FILE"
fi

# Calculate wait time (add 90s buffer after reset)
WAIT_SECONDS=$(( RESETS_AT - NOW + 90 ))
[ "$WAIT_SECONDS" -lt 60 ] && WAIT_SECONDS=60

RESET_TIME=$(date -r "$RESETS_AT" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "unknown")

# Schedule resume in background
nohup bash -c 'sleep "$1"; exec "$2"' _ "$WAIT_SECONDS" "$RESUME_SCRIPT" > /dev/null 2>&1 &

RESUME_PID=$!
echo "$RESUME_PID" > "$RESUME_PID_FILE"

# Desktop notification
osascript -e "display notification \"Rate limit hit. Auto-resume scheduled at ${RESET_TIME}\" with title \"Claude Code Paused\" subtitle \"Session: ${SESSION_ID}\"" 2>/dev/null

# Log
echo "[$(date)] Rate limit stop: session=$SESSION_ID, resets_at=$RESET_TIME, resume_pid=$RESUME_PID" >> "$STATE_DIR/rate-limit.log"
