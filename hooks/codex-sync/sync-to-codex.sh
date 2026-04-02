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
COMPILER="$SCRIPT_DIR/compile-rules.py"
LOG="$CLAUDE_DIR/shared-knowledge/sync.log"

log() {
  printf '[%s] %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" >> "$LOG" 2>/dev/null
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
  # Even if hash unchanged, verify target file still exists and matches
  if [ -f "$OUTPUT" ]; then
    TARGET_HASH=$(python3 -c "
import hashlib, sys
try:
    with open('$OUTPUT', 'rb') as f: print(hashlib.sha256(f.read()).hexdigest())
except: print('')
" 2>/dev/null)
    if [ "$TARGET_HASH" = "$NEW_HASH" ]; then
      log "SKIP: rules unchanged and target intact (hash=$OLD_HASH)"
      exit 0
    fi
    log "TARGET_DRIFT: AGENTS.md content differs from manifest, re-syncing"
  else
    log "TARGET_MISSING: $OUTPUT does not exist, re-syncing"
  fi
fi

# Write to Codex AGENTS.md
cp "$TMPFILE" "$OUTPUT"
FILESIZE=$(wc -c < "$OUTPUT" | tr -d ' ')

log "SYNCED: $FILESIZE bytes -> $OUTPUT (hash=${NEW_HASH:0:12}...)"

# Report to stderr for hook visibility
echo "Codex AGENTS.md synced: ${FILESIZE} bytes" >&2

exit 0
