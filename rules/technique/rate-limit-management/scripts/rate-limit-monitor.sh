#!/bin/bash
# Rate Limit Monitor - reads statusline JSON from stdin, writes state file
# Called via statusline wrapper on every tick

STATE_DIR="$HOME/.claude"
STATE_FILE="$STATE_DIR/rate-limit-state.json"
THRESHOLD=${RATE_LIMIT_THRESHOLD:-95}

INPUT=$(cat)

# Extract rate_limits data
FIVE_HOUR_PCT=$(echo "$INPUT" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
FIVE_HOUR_RESET=$(echo "$INPUT" | jq -r '.rate_limits.five_hour.resets_at // empty' 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# No rate_limits data yet (first tick before API response)
[ -z "$FIVE_HOUR_PCT" ] && exit 0

NOW=$(date +%s)

# Write state file (always, for external tools to read)
cat > "$STATE_FILE" <<EOF
{
  "five_hour_pct": $FIVE_HOUR_PCT,
  "resets_at": ${FIVE_HOUR_RESET:-0},
  "updated_at": $NOW,
  "session_id": "${SESSION_ID:-}",
  "threshold_exceeded": $(awk "BEGIN{print ($FIVE_HOUR_PCT >= $THRESHOLD) ? \"true\" : \"false\"}")
}
EOF

# Desktop notification when threshold exceeded
PCT_INT=$(printf "%.0f" "$FIVE_HOUR_PCT")
if [ "$PCT_INT" -ge "$THRESHOLD" ] 2>/dev/null; then
  NOTIFIED_FILE="$STATE_DIR/.rate-limit-notified"
  # Only notify once per window (check if notified file is recent)
  if [ ! -f "$NOTIFIED_FILE" ] || [ $((NOW - $(stat -f%m "$NOTIFIED_FILE" 2>/dev/null || echo 0))) -gt 300 ]; then
    RESET_TIME=$(date -r "${FIVE_HOUR_RESET:-0}" "+%H:%M" 2>/dev/null || echo "unknown")
    osascript -e "display notification \"Usage at ${PCT_INT}%, resets at ${RESET_TIME}\" with title \"Claude Code Rate Limit Warning\"" 2>/dev/null
    touch "$NOTIFIED_FILE"
  fi
fi
