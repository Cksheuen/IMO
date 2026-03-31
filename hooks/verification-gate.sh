#!/bin/bash
# Verification Gate - Stop hook
# Checks for pending features in the current project's feature-list.json before allowing session to stop.
# If pending features exist, blocks stopping (exit 2) and triggers verification.
#
# Safety: checks stop_hook_active to prevent infinite loops.
# Iteration limit: checks attempt_count vs max_attempts to prevent endless retry.
#
# Flow:
#   1. Stop hook fires → read stdin
#   2. Check stop_hook_active → if true, exit 0 (prevent loop)
#   3. Check feature-list.json exists → if not, exit 0 (no verification needed)
#   4. Check iteration limits → if exceeded, allow stop with warning
#   5. Check summary.pending → if > 0, block and trigger reviewer
#   6. If all features passed → exit 0 (allow stop)

set -u

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

# Task path resolution order:
# 1. current git project's .claude/tasks
# 2. nearest ancestor .claude/tasks when outside git
# 3. ~/.claude/tasks fallback

TASKS_DIR=$(resolve_tasks_dir)
FEATURE_LIST="$TASKS_DIR/current/feature-list.json"

INPUT=$(cat)

# SAFETY: Prevent infinite loops - if already in forced continuation, let it stop
STOP_ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_ACTIVE" = "true" ]; then
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
  "  - [\(.id)] \(.description[:50]) (attempts: \(.attempt_count)/\(.max_attempts))"
' "$FEATURE_LIST" 2>/dev/null)

if [ -n "$EXCEEDED_FEATURES" ]; then
  cat >&2 <<EOF
Verification stopped: iteration limit reached.

The following features exceeded max attempts:
$EXCEEDED_FEATURES

These features will be marked as "blocked" and require manual intervention.
To proceed, mark the task as completed:
   jq '.status = "completed"' $FEATURE_LIST
EOF
  # Mark task as completed to allow stop
  jq '.status = "completed"' "$FEATURE_LIST" > /dev/null
  exit 0
fi

# Get pending features with details
PENDING_DETAILS=$(jq -r '
  .features[] | select(.passes == null or .passes == false) |
  "Feature: \(.id) - \(.description[:60])
   Status: \(.passes // "pending" // "failed")
   Attempts: \(.attempt_count // 0)/\(.max_attempts // 3)
   \(.notes // "")
' "$FEATURE_LIST" 2>/dev/null | head -5)

# Get failed features for fix suggestions
FAILED_FEATURES=$(jq -r '
  .features[] | select(.passes == false) |
  "  - [\(.id)] \(.description[:50]): \(.notes[:80] // "no notes")
' "$FEATURE_LIST" 2>/dev/null)

# Calculate progress percentage
if [ "$TOTAL" -gt 0 ]; then
  PROGRESS=$((PASSED * 100 / TOTAL))
else
  PROGRESS=0
fi

# Build fix suggestions for failed features
FIX_SUGGESTIONS=""
if [ -n "$FAILED_FEATURES" ]; then
  FIX_SUGGESTIONS="

Failed features need fixing:
$FAILED_FEATURES

For each failed feature:
1. Analy the failure reason in .notes
2. Review the acceptance_criteria
3. Implement fix
4. Update feature-list.json:
   jq '(.features[] | select(.id == "F001") | .passes) = true | .verified_at) = "'$(date -I --iso-8601-seconds=utc)'"' $FEATURE_LIST
"
fi

# Block with verification instructions
cat >&2 <<EOF
Verification required before finishing.

Task progress: $PASSED/$TOTAL ($PROGRESS%) - $PENDING pending feature(s):

Pending features:
$PENDING_DETAILS
$FIX_SUGGESTIONS
─────────────────────────────────────────
Verification workflow:

Option A - Manual verification:
1. Review each pending feature against its acceptance criteria
2. Run verification (tests, E2E, or manual checks)
3. Update feature-list.json:
   # Mark as passed
   jq '(.features[] | select(.id == "FEATURE_ID") | .passes) = true | .verified_at) = "'$(date -I --iso-8601-seconds=utc)'" $FEATURE_LIST

   # Mark as failed (increments attempt_count)
   jq '(.features[] | select(.id == "FEATURE_ID") | .passes = false | .attempt_count += 1 | .notes = "reason")' $FEATURE_LIST

Option B - Automated reviewer agent:
   Use the reviewer agent to verify implementation quality:
   Agent(subagent_type: "reviewer", prompt: "Verify feature-list.json at $FEATURE_LIST")

Option C - Skip verification (marks task as completed):
   jq '.status = "completed"' $FEATURE_LIST
   echo "Verification skipped by user request"
EOF

exit 2
