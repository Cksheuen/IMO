#!/bin/bash
# Rate Limit Monitor - reads statusline JSON from stdin, writes state file
# Called via statusline wrapper on every tick
# Monitors BOTH five_hour and seven_day windows

STATE_DIR="$HOME/.claude"
STATE_FILE="$STATE_DIR/rate-limit-state.json"
THRESHOLD=${RATE_LIMIT_THRESHOLD:-95}

INPUT=$(cat)

# Extract rate_limits data - both windows
FIVE_HOUR_PCT=$(echo "$INPUT" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
FIVE_HOUR_RESET=$(echo "$INPUT" | jq -r '.rate_limits.five_hour.resets_at // empty' 2>/dev/null)
SEVEN_DAY_PCT=$(echo "$INPUT" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null)
SEVEN_DAY_RESET=$(echo "$INPUT" | jq -r '.rate_limits.seven_day.resets_at // empty' 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# No rate_limits data yet (first tick before API response)
[ -z "$FIVE_HOUR_PCT" ] && exit 0

# Defaults
SEVEN_DAY_PCT=${SEVEN_DAY_PCT:-0}
SEVEN_DAY_RESET=${SEVEN_DAY_RESET:-0}

NOW=$(date +%s)

# Determine binding constraint (whichever is closer to limit)
FIVE_INT=$(printf "%.0f" "$FIVE_HOUR_PCT")
SEVEN_INT=$(printf "%.0f" "$SEVEN_DAY_PCT")

if [ "$SEVEN_INT" -ge "$FIVE_INT" ] 2>/dev/null; then
  BINDING_WINDOW="seven_day"
  BINDING_PCT="$SEVEN_DAY_PCT"
  BINDING_RESET="${SEVEN_DAY_RESET}"
else
  BINDING_WINDOW="five_hour"
  BINDING_PCT="$FIVE_HOUR_PCT"
  BINDING_RESET="${FIVE_HOUR_RESET}"
fi

BINDING_INT=$(printf "%.0f" "$BINDING_PCT")

# Write state file
cat > "$STATE_FILE" <<EOF
{
  "five_hour_pct": $FIVE_HOUR_PCT,
  "five_hour_resets_at": ${FIVE_HOUR_RESET:-0},
  "seven_day_pct": $SEVEN_DAY_PCT,
  "seven_day_resets_at": ${SEVEN_DAY_RESET:-0},
  "binding_window": "${BINDING_WINDOW}",
  "binding_pct": $BINDING_PCT,
  "resets_at": $BINDING_RESET,
  "updated_at": $NOW,
  "session_id": "${SESSION_ID:-}",
  "threshold_exceeded": $(awk "BEGIN{print ($BINDING_PCT >= $THRESHOLD) ? \"true\" : \"false\"}")
}
EOF

# Desktop notification when either window exceeds threshold
if [ "$BINDING_INT" -ge "$THRESHOLD" ] 2>/dev/null; then
  NOTIFIED_FILE="$STATE_DIR/.rate-limit-notified"
  if [ ! -f "$NOTIFIED_FILE" ] || [ $((NOW - $(stat -f%m "$NOTIFIED_FILE" 2>/dev/null || echo 0))) -gt 300 ]; then
    RESET_TIME=$(date -r "$BINDING_RESET" "+%H:%M" 2>/dev/null || echo "unknown")
    WINDOW_LABEL="5h"
    [ "$BINDING_WINDOW" = "seven_day" ] && WINDOW_LABEL="7d"
    osascript -e "display notification \"${WINDOW_LABEL} usage at ${BINDING_INT}%, resets at ${RESET_TIME}\" with title \"Claude Code Rate Limit Warning\"" 2>/dev/null
    touch "$NOTIFIED_FILE"
  fi
fi
