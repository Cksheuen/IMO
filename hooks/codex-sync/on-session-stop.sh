#!/bin/bash
# Stop hook fallback for Codex sync when PostToolUse is missing or ineffective.
# Never blocks the Stop event path.

set -u

CLAUDE_DIR="$HOME/.claude"
SYNC_SCRIPT="$CLAUDE_DIR/hooks/codex-sync/sync-to-codex.sh"
STATE_FILE="$CLAUDE_DIR/.codex-sync-debounce"
LOG="$CLAUDE_DIR/shared-knowledge/sync.log"
RECENT_WINDOW_SECONDS=30

log() {
  printf '[%s] %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" >> "$LOG" 2>/dev/null || true
}

has_recent_post_edit() {
  local key=""
  local now=""
  local raw=""
  local ts=""

  now=$(date +%s 2>/dev/null || printf '')
  [ -n "$now" ] || return 1
  [ -f "$STATE_FILE" ] || return 1

  raw=$(cat "$STATE_FILE" 2>/dev/null || printf '')
  [ -n "$raw" ] || return 1

  for key in rules rules-library notes-lessons; do
    ts=$(printf '%s' "$raw" | sed -nE "s/.*\"$key\"[[:space:]]*:[[:space:]]*([0-9]+).*/\\1/p" | head -n 1)
    case "$ts" in
      ''|*[!0-9]*)
        continue
        ;;
    esac

    if [ $((now - ts)) -lt "$RECENT_WINDOW_SECONDS" ] 2>/dev/null; then
      return 0
    fi
  done

  return 1
}

spawn_sync() {
  local pid=""

  if command -v nohup >/dev/null 2>&1; then
    nohup env TRIGGERED_BY=stop-fallback bash "$SYNC_SCRIPT" >> "$LOG" 2>&1 &
  else
    env TRIGGERED_BY=stop-fallback bash "$SYNC_SCRIPT" >> "$LOG" 2>&1 &
  fi

  pid=$!
  disown "$pid" 2>/dev/null || true
  log "TRIGGERED_BY=stop-fallback reason=<no-post-edit-within-30s> pid=$pid"
}

cd "$CLAUDE_DIR" 2>/dev/null || exit 0
[ -x "$SYNC_SCRIPT" ] || exit 0

STATUS=$(git -C "$CLAUDE_DIR" status --porcelain -- rules/ rules-library/ notes/lessons/ 2>/dev/null) || exit 0
[ -n "$STATUS" ] || exit 0

has_recent_post_edit && exit 0

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
spawn_sync

exit 0
