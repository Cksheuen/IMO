#!/bin/bash
# Verification Gate - Stop hook
# Checks for pending features in the current project's feature-list.json before allowing session to stop.
# If pending features exist, blocks stopping (exit 2) and triggers verification.
#
# Safety: checks stop_hook_active to prevent infinite loops.
# Iteration limit: checks attempt_count vs max_attempts to prevent endless retry.
#
# Flow:
#   1. Stop hook fires -> read stdin
#   2. Check stop_hook_active -> if true, exit 0 (prevent loop)
#   3. Check feature-list.json exists -> if not, exit 0 (no verification needed)
#   4. Check iteration limits -> if exceeded, allow stop with warning
#   5. Check summary.pending -> if > 0, block and trigger reviewer
#   6. If all features passed -> exit 0 (allow stop)

set -u

timestamp_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
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
   "  - [\(.id)] \(.description[:50]) (attempts: \(.attempt_count)/\(.max_attempts))"]
  | join("\n")
' "$FEATURE_LIST" 2>/dev/null)

if [ -n "$EXCEEDED_FEATURES" ]; then
  cat >&2 <<EOF2
Verification stopped: iteration limit reached.

The following features exceeded max attempts:
$EXCEEDED_FEATURES

These features will be marked as "blocked" and require manual intervention.
To proceed, mark the task as completed:
   jq '.status = "completed"' $FEATURE_LIST
EOF2
  write_feature_list '.status = "completed"'
  exit 0
fi

# Check for failed features (passes = false) that need fixing
FAILED_COUNT=$(jq -r '
  [.features[] | select(.passes == false and .attempt_count < .max_attempts)] | length
' "$FEATURE_LIST" 2>/dev/null)

if [ "$FAILED_COUNT" -gt 0 ] 2>/dev/null; then
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

  cat >&2 <<EOF2
VERIFICATION_FAILED: Fix required for $FAILED_COUNT feature(s).

Task progress: $PASSED/$TOTAL ($PROGRESS%) - $FAILED_COUNT failed feature(s):

$FAILED_DETAILS

─────────────────────────────────────────
FIXER LOOP TRIGGER:
Spawn implementer agent to fix the failed features.

Agent(subagent_type: "implementer", isolation: "worktree", prompt: """
## Fix Task: Correct failed implementation

### Delta Context (from reviewer)
$DELTA_CONTEXT_JSON

### Fix Instructions
1. For each failed feature in the array, read only the files specified in delta_context.files_to_read
2. Apply the corresponding delta_context.fix_suggestion
3. Do NOT modify files listed in delta_context.files_to_skip
4. When fixes are ready, reset those features to passes = null so reviewer can verify again
5. Commit when done
6. The features will be re-verified automatically
""")

─────────────────────────────────────────
IMPORTANT: Main agent should NOT modify code directly.
Spawn implementer agent to perform the fix.
EOF2
  exit 2
fi

# Get pending features with details (passes = null, not false)
PENDING_DETAILS=$(jq -r '
  .features[] | select(.passes == null) |
  [
    "Feature: " + .id + " - " + (.description[:60]),
    "  Status: pending verification",
    "  " + (.notes // "")
  ] | join("
")
' "$FEATURE_LIST" 2>/dev/null | head -5)

if [ "$TOTAL" -gt 0 ]; then
  PROGRESS=$((PASSED * 100 / TOTAL))
else
  PROGRESS=0
fi

cat >&2 <<EOF2
VERIFICATION_REQUIRED: $PENDING pending feature(s) need review.

Task progress: $PASSED/$TOTAL ($PROGRESS%) - $PENDING pending feature(s):

Pending features:
$PENDING_DETAILS

─────────────────────────────────────────
Verification workflow:

Option A - Manual verification:
1. Review each pending feature against its acceptance criteria
2. Run verification (tests, E2E, or manual checks)
3. Update feature-list.json:
   # Mark as passed
   jq '(.features[] | select(.id == "FEATURE_ID") | .passes) = true |
       (.features[] | select(.id == "FEATURE_ID") | .verified_at) = "TIMESTAMP" |
       (.features[] | select(.id == "FEATURE_ID") | .delta_context) = null |
       .summary.passed += 1 |
       .summary.pending -= 1' $FEATURE_LIST

   # Mark as failed (increments attempt_count)
   jq '(.features[] | select(.id == "FEATURE_ID") | .passes) = false |
       (.features[] | select(.id == "FEATURE_ID") | .attempt_count) += 1 |
       (.features[] | select(.id == "FEATURE_ID") | .notes) = "reason" |
       (.features[] | select(.id == "FEATURE_ID") | .delta_context) = {"root_cause":"reason","fix_suggestion":{"details":"describe fix"},"files_to_read":["path:line-range"],"files_to_skip":[]}' $FEATURE_LIST

   # Reset to pending after implementer finishes a fix
   jq '(.features[] | select(.id == "FEATURE_ID") | .passes) = null |
       (.features[] | select(.id == "FEATURE_ID") | .verified_at) = null' $FEATURE_LIST

Option B - Automated reviewer agent:
   Agent(subagent_type: "reviewer", prompt: "Verify feature-list.json at $FEATURE_LIST")

Option C - Skip verification (marks task as completed):
   jq '.status = "completed"' $FEATURE_LIST
EOF2

exit 2
