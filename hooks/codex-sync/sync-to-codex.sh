#!/bin/bash
# CC → Codex 规则同步脚本
# 从 CC 的 rules/skills/lessons 提炼生成 ~/.codex/AGENTS.md
#
# 调用方式：
#   bash ~/.claude/hooks/codex-sync/sync-to-codex.sh
#   bash ~/.claude/hooks/codex-sync/sync-to-codex.sh --force  # 强制同步（忽略哈希对比）

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
CODEX_DIR="$HOME/.codex"
MANIFEST="$CLAUDE_DIR/shared-knowledge/sync-manifest.json"
OUTPUT="$CODEX_DIR/AGENTS.md"
PROJECT_OUTPUT="$CLAUDE_DIR/AGENTS.md"
COMPILER="$SCRIPT_DIR/compile-rules.py"
LOG="$CLAUDE_DIR/shared-knowledge/sync.log"

log() {
  printf '[%s] %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" >> "$LOG" 2>/dev/null
}

file_sha256() {
  python3 - "$1" <<'PY' 2>/dev/null
import hashlib
import sys

path = sys.argv[1]
try:
    with open(path, 'rb') as f:
        print(hashlib.sha256(f.read()).hexdigest())
except Exception:
    print("")
PY
}

target_matches_hash() {
  local target="$1"
  local expected_hash="$2"
  [ -f "$target" ] || return 1
  [ "$(file_sha256 "$target")" = "$expected_hash" ]
}

sync_target() {
  local target="$1"
  local label="$2"

  if ! cp "$TMPFILE" "$target"; then
    log "ERROR: failed to write $label target at $target"
    echo "Failed to sync $label AGENTS.md: $target" >&2
    return 1
  fi

  local filesize
  filesize=$(wc -c < "$target" | tr -d ' ')
  log "SYNCED[$label]: $filesize bytes -> $target (hash=${NEW_HASH:0:12}...)"
  echo "$label AGENTS.md synced: ${filesize} bytes" >&2
}

# Ensure directories exist
mkdir -p "$CODEX_DIR" "$(dirname "$MANIFEST")" "$(dirname "$LOG")"

# Check compiler exists
if [ ! -f "$COMPILER" ]; then
  log "ERROR: compiler not found at $COMPILER"
  exit 1
fi

FORCE=false
[ "${1:-}" = "--force" ] && FORCE=true

# Get current rules hash from manifest
OLD_HASH=""
if [ -f "$MANIFEST" ]; then
  OLD_HASH=$(python3 -c "
import json, sys
try:
    with open('$MANIFEST') as f: print(json.load(f).get('rules_hash', ''))
except: pass
" 2>/dev/null)
fi

# Compile rules to temp file
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

python3 "$COMPILER" --output "$TMPFILE" --manifest "$MANIFEST" 2>/dev/null
COMPILE_STATUS=$?

if [ $COMPILE_STATUS -ne 0 ]; then
  log "ERROR: compile-rules.py failed with status $COMPILE_STATUS"
  exit 1
fi

# Check if content changed
NEW_HASH=$(python3 -c "
import json
try:
    with open('$MANIFEST') as f: print(json.load(f).get('rules_hash', ''))
except: print('')
" 2>/dev/null)

if [ "$FORCE" = false ] && [ -n "$OLD_HASH" ] && [ "$OLD_HASH" = "$NEW_HASH" ]; then
  if target_matches_hash "$OUTPUT" "$NEW_HASH" && target_matches_hash "$PROJECT_OUTPUT" "$NEW_HASH"; then
    log "SKIP: rules unchanged and all targets intact (hash=$OLD_HASH)"
    exit 0
  fi

  [ -f "$OUTPUT" ] || log "TARGET_MISSING: $OUTPUT does not exist, re-syncing"
  [ -f "$PROJECT_OUTPUT" ] || log "TARGET_MISSING: $PROJECT_OUTPUT does not exist, re-syncing"
  target_matches_hash "$OUTPUT" "$NEW_HASH" || log "TARGET_DRIFT: $OUTPUT differs from manifest, re-syncing"
  target_matches_hash "$PROJECT_OUTPUT" "$NEW_HASH" || log "TARGET_DRIFT: $PROJECT_OUTPUT differs from manifest, re-syncing"
fi

# Write to both Codex global config and the current ~/.claude project root.
sync_target "$OUTPUT" "codex-global"
sync_target "$PROJECT_OUTPUT" "claude-project"

exit 0
