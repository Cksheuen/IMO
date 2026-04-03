#!/bin/bash
# Verification Gate - Stop hook
# Checks for pending features in the current project's feature-list.json before allowing session to stop.
# If pending features exist, blocks stopping (exit 2) and triggers verification.
#
# Safety: checks stop_hook_active to prevent infinite loops.
# Iteration limit: checks attempt_count vs max_attempts to prevent endless retry.
#
# Structured logs are written to ~/.claude/logs/stop-hook/.
# Human/actionable feedback is still sent to stderr so existing stop-hook
# consumers continue to receive the verification instructions.
#
# Exit codes:
#   0 = Allow stop (no pending features or all verified)
#   2 = Block stop (pending features need verification)

set -u

# --- Log directory setup ---
LOG_DIR="$HOME/.claude/logs/stop-hook"
CURRENT_LOG="$LOG_DIR/current.json"
HISTORY_LOG="$LOG_DIR/history.jsonl"
mkdir -p "$LOG_DIR"

timestamp_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Write structured log entry (JSON)
write_current_log() {
  local status="$1"
  local reason="$2"
  local details="${3:-null}"
  local session_id="${4:-}"

  cat > "$CURRENT_LOG" <<EOF
{
  "timestamp": "$(timestamp_utc)",
  "status": "$status",
  "reason": "$reason",
  "session_id": "$session_id",
  "details": $details
}
EOF
}

# Append to history log (JSONL)
append_history() {
  local entry="$1"
  echo "$entry" >> "$HISTORY_LOG"
}

emit_stderr() {
  printf '%s\n' "$1" >&2
}

write_feature_list() {
  local filter tmp
  filter=$1
  tmp=$(mktemp)
  jq "$filter" "$FEATURE_LIST" > "$tmp" && mv "$tmp" "$FEATURE_LIST"
}

resolve_tasks_dir() {
  local git_root dir

  if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    if [ "$(basename "$git_root")" = ".claude" ]; then
      printf '%s/tasks\n' "$git_root"
    else
      printf '%s/.claude/tasks\n' "$git_root"
    fi
    return
  fi

  dir="$PWD"
  while :; do
    if [ "$(basename "$dir")" = ".claude" ]; then
      printf '%s/tasks\n' "$dir"
      return
    fi

    if [ -d "$dir/.claude" ]; then
      printf '%s/.claude/tasks\n' "$dir"
      return
    fi

    [ "$dir" = "/" ] && break
    dir=$(dirname "$dir")
  done

  printf '%s/tasks\n' "$HOME/.claude"
}

TASKS_DIR=$(resolve_tasks_dir)
FEATURE_LIST="$TASKS_DIR/current/feature-list.json"

INPUT=$(cat)

# SAFETY: Prevent infinite loops - if already in forced continuation, let it stop
STOP_ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_ACTIVE" = "true" ]; then
  write_current_log "allowed" "stop_hook_active=true (loop prevention)" "null" ""
  exit 0
fi

# No feature list = no verification needed
[ ! -f "$FEATURE_LIST" ] && exit 0

# Check session match - only enforce for current session
CURRENT_SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
LIST_SESSION=$(jq -r '.session_id // empty' "$FEATURE_LIST" 2>/dev/null)

if [ -n "$CURRENT_SESSION" ] && [ -n "$LIST_SESSION" ] && [ "$CURRENT_SESSION" != "$LIST_SESSION" ]; then
  exit 0
fi

# Check task status
TASK_STATUS=$(jq -r '.status // "completed"' "$FEATURE_LIST" 2>/dev/null)
if [ "$TASK_STATUS" = "completed" ]; then
  exit 0
fi
if [ "$TASK_STATUS" = "blocked" ]; then
  write_current_log "allowed" "task status blocked; manual intervention required" "null" "$CURRENT_SESSION"
  exit 0
fi

# Read summary
PENDING=$(jq -r '.summary.pending // 0' "$FEATURE_LIST" 2>/dev/null)
TOTAL=$(jq -r '.summary.total // 0' "$FEATURE_LIST" 2>/dev/null)
PASSED=$(jq -r '.summary.passed // 0' "$FEATURE_LIST" 2>/dev/null)

# No pending features = all verified
[ "$PENDING" -eq 0 ] 2>/dev/null && exit 0

# Check iteration limits for failed features
# If any feature has reached max_attempts, flag it and allow stop with warning
EXCEEDED_FEATURES=$(jq -r '
  [.features[] | select(.passes == false and .attempt_count >= .max_attempts) |
   "  - [\(.id)] \(.description[:50]) (attempts: \(.attempt_count)/\(.max_attempts))"]
  | join("\n")
' "$FEATURE_LIST" 2>/dev/null)

if [ -n "$EXCEEDED_FEATURES" ]; then
  # Write to log file instead of stderr
  DETAILS=$(jq -c -n \
    --argjson features "$(jq -c '[.features[] | select(.passes == false and .attempt_count >= .max_attempts) | {id, description, attempt_count, max_attempts}]' "$FEATURE_LIST")" \
    '$ARGS.named')

  write_current_log "iteration_exceeded" "Features exceeded max attempts" "$DETAILS" "$CURRENT_SESSION"

  append_history "$(jq -c -n \
    --arg ts "$(timestamp_utc)" \
    --arg session "$CURRENT_SESSION" \
    --argjson features "$(jq -c '[.features[] | select(.passes == false and .attempt_count >= .max_attempts) | {id, description, attempt_count, max_attempts}]' "$FEATURE_LIST")" \
    '{timestamp: $ts, event: "iteration_exceeded", session_id: $session, features: $features}')"

  emit_stderr "Verification stopped: iteration limit reached.

The following features exceeded max attempts:
$EXCEEDED_FEATURES

These features are now blocked and require manual intervention.
To continue later, update $FEATURE_LIST after resolving the blocker."

  write_feature_list '.status = "blocked"'
  exit 0
fi

# Check for failed features (passes = false) that need fixing
FAILED_DETAILS=$(jq -r '
  .features[] | select(.passes == false and .attempt_count < .max_attempts) |
  [
    "Feature: " + .id + " - " + (.description[:60]),
    "  Root Cause: " + (.delta_context.root_cause // .notes[:80] // "No root cause provided"),
    "  Fix Suggestion: " + (.delta_context.fix_suggestion.details[:80] // "No fix suggestion"),
    "  Files to Read: " + ((.delta_context.files_to_read // ["All related files"]) | join(", ")),
    "  Attempt: " + (.attempt_count | tostring) + "/" + (.max_attempts | tostring)
  ] | join("\n")
' "$FEATURE_LIST" 2>/dev/null | head -10)

FAILED_COUNT=$(jq -r '
  [.features[] | select(.passes == false and .attempt_count < .max_attempts)] | length
' "$FEATURE_LIST" 2>/dev/null)

if [ "$FAILED_COUNT" -gt 0 ] 2>/dev/null; then
  DELTA_CONTEXT_JSON=$(jq -c '
    [.features[]
     | select(.passes == false and .attempt_count < .max_attempts)
     | {
         feature_id: .id,
         description: .description,
         delta_context: (.delta_context // {
           root_cause: (.notes // "No root cause provided"),
           fix_suggestion: {
             details: "Inspect acceptance criteria and repair the failed implementation"
           },
           files_to_read: ["All related files"],
           files_to_skip: []
         })
       }]
  ' "$FEATURE_LIST" 2>/dev/null)

  if [ "$TOTAL" -gt 0 ]; then
    PROGRESS=$((PASSED * 100 / TOTAL))
  else
    PROGRESS=0
  fi

  # Write structured log instead of stderr
  DETAILS=$(jq -c -n \
    --arg progress "$PROGRESS" \
    --argjson passed "$PASSED" \
    --argjson total "$TOTAL" \
    --argjson failed_count "$FAILED_COUNT" \
    --argjson features "$DELTA_CONTEXT_JSON" \
    '$ARGS.named')

  write_current_log "verification_failed" "Features need fixing before stop" "$DETAILS" "$CURRENT_SESSION"

  # Append to history
  append_history "$(jq -c -n \
    --arg ts "$(timestamp_utc)" \
    --arg session "$CURRENT_SESSION" \
    --argjson passed "$PASSED" \
    --argjson total "$TOTAL" \
    --argjson failed_count "$FAILED_COUNT" \
    --argjson features "$DELTA_CONTEXT_JSON" \
    '{timestamp: $ts, event: "verification_failed", session_id: $session, progress: "\($passed)/\($total)", failed_count: $failed_count, features: $features}')"

  emit_stderr "VERIFICATION_FAILED: Fix required for $FAILED_COUNT feature(s).

Task progress: $PASSED/$TOTAL ($PROGRESS%) - $FAILED_COUNT failed feature(s).

$FAILED_DETAILS

Fix task details have also been logged to $CURRENT_LOG."

  exit 2
fi

# Get pending features with details (passes = null, not false)
PENDING_DETAILS=$(jq -r '
  .features[] | select(.passes == null) |
  [
    "Feature: " + .id + " - " + (.description[:60]),
    "  Status: pending verification",
    "  " + (.notes // "")
  ] | join("\n")
' "$FEATURE_LIST" 2>/dev/null | head -5)

PENDING_FEATURES_JSON=$(jq -c '[.features[] | select(.passes == null) | {id, description, notes}]' "$FEATURE_LIST" 2>/dev/null)

if [ "$TOTAL" -gt 0 ]; then
  PROGRESS=$((PASSED * 100 / TOTAL))
else
  PROGRESS=0
fi

# Write structured log for pending verification
DETAILS=$(jq -c -n \
  --arg progress "$PROGRESS" \
  --argjson passed "$PASSED" \
  --argjson total "$TOTAL" \
  --argjson pending "$PENDING" \
  --argjson features "$PENDING_FEATURES_JSON" \
  '$ARGS.named')

write_current_log "verification_required" "Pending features need verification" "$DETAILS" "$CURRENT_SESSION"

# Append to history
append_history "$(jq -c -n \
  --arg ts "$(timestamp_utc)" \
  --arg session "$CURRENT_SESSION" \
  --argjson passed "$PASSED" \
  --argjson total "$TOTAL" \
  --argjson pending "$PENDING" \
  --argjson features "$PENDING_FEATURES_JSON" \
  '{timestamp: $ts, event: "verification_required", session_id: $session, progress: "\($passed)/\($total)", pending: $pending, features: $features}')"

emit_stderr "VERIFICATION_REQUIRED: $PENDING pending feature(s) need review.

Task progress: $PASSED/$TOTAL ($PROGRESS%) - $PENDING pending feature(s).

Pending features:
$PENDING_DETAILS

Pending feature details have also been logged to $CURRENT_LOG."

exit 2
