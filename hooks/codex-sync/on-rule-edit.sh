#!/bin/bash
# Trigger Codex sync after rule/lesson edits with debounce.
# Reads Claude Code hook payload from stdin and never blocks the editor path.

set -u

CLAUDE_DIR="$HOME/.claude"
SYNC_SCRIPT="$CLAUDE_DIR/hooks/codex-sync/sync-to-codex.sh"
STATE_FILE="$CLAUDE_DIR/.codex-sync-debounce"
LOG="$CLAUDE_DIR/shared-knowledge/sync.log"
DEBOUNCE_SECONDS=5

log() {
  printf '[%s] %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" >> "$LOG" 2>/dev/null || true
}

spawn_sync() {
  local pid=""

  if command -v nohup >/dev/null 2>&1; then
    nohup env TRIGGERED_BY=post-edit bash "$SYNC_SCRIPT" >> "$LOG" 2>&1 &
  else
    env TRIGGERED_BY=post-edit bash "$SYNC_SCRIPT" >> "$LOG" 2>&1 &
  fi

  pid=$!
  disown "$pid" 2>/dev/null || true
  log "TRIGGERED_BY=post-edit category=$1 file=$2 pid=$pid"
}

INPUT=$(cat 2>/dev/null || printf '')
[ -n "$INPUT" ] || {
  log "POST_EDIT_HOOK_INVOKED tool= file="
  exit 0
}

BEACON_PARSED=""
if command -v jq >/dev/null 2>&1; then
  BEACON_PARSED=$(
    printf '%s' "$INPUT" | jq -r '
      [
        (.tool_name // .toolName // ""),
        ((.tool_input // .toolInput // {}).file_path // "")
      ] | @tsv
    ' 2>/dev/null || printf ''
  )
elif command -v python3 >/dev/null 2>&1; then
  BEACON_PARSED=$(
    INPUT_JSON="$INPUT" python3 - <<'PY' 2>/dev/null
import json
import os

raw = os.environ.get("INPUT_JSON", "")
tool_name = ""
file_path = ""

if raw.strip():
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {}
    if isinstance(payload, dict):
        value = payload.get("tool_name") or payload.get("toolName") or ""
        if isinstance(value, str):
            tool_name = value

        tool_input = payload.get("tool_input")
        if not isinstance(tool_input, dict):
            tool_input = payload.get("toolInput")
        if isinstance(tool_input, dict):
            value = tool_input.get("file_path", "")
            if isinstance(value, str):
                file_path = value

print(f"{tool_name}\t{file_path}")
PY
  )
fi

tool_name=${BEACON_PARSED%%$'\t'*}
file_path_raw=""
if [ -n "$BEACON_PARSED" ] && [ "$BEACON_PARSED" != "$tool_name" ]; then
  file_path_raw=${BEACON_PARSED#*$'\t'}
fi
log "POST_EDIT_HOOK_INVOKED tool=$tool_name file=$file_path_raw"

[ -n "$INPUT" ] || exit 0

command -v python3 >/dev/null 2>&1 || exit 0
[ -x "$SYNC_SCRIPT" ] || exit 0

PARSED=$(
  INPUT_JSON="$INPUT" CLAUDE_DIR="$CLAUDE_DIR" python3 - <<'PY' 2>/dev/null
import json
import os
import sys

base = os.environ.get("CLAUDE_DIR", "")
raw = os.environ.get("INPUT_JSON", "")
if not base or not raw.strip():
    raise SystemExit(0)

try:
    payload = json.loads(raw)
except Exception:
    raise SystemExit(0)

if not isinstance(payload, dict):
    raise SystemExit(0)

tool_input = payload.get("tool_input")
if not isinstance(tool_input, dict):
    tool_input = payload.get("toolInput")
if not isinstance(tool_input, dict):
    tool_input = {}

file_path = tool_input.get("file_path", "")
if not isinstance(file_path, str) or not file_path.strip():
    raise SystemExit(0)

file_path = file_path.strip()
if not os.path.isabs(file_path):
    file_path = os.path.abspath(os.path.join(base, file_path))
file_path = os.path.normpath(file_path)

def in_prefix(path: str, prefix: str) -> bool:
    prefix = os.path.normpath(prefix)
    return path == prefix or path.startswith(prefix + os.sep)

if in_prefix(file_path, os.path.join(base, "shared-knowledge")):
    raise SystemExit(0)

prefixes = [
    ("rules", os.path.join(base, "rules")),
    ("rules-library", os.path.join(base, "rules-library")),
    ("notes-lessons", os.path.join(base, "notes", "lessons")),
]

for category, prefix in prefixes:
    if in_prefix(file_path, prefix):
        print(f"{category}\t{file_path}")
        raise SystemExit(0)
PY
)

[ -n "$PARSED" ] || exit 0

category=${PARSED%%$'\t'*}
file_path=${PARSED#*$'\t'}

SHOULD_TRIGGER=$(
  CATEGORY="$category" STATE_FILE="$STATE_FILE" DEBOUNCE_SECONDS="$DEBOUNCE_SECONDS" python3 - <<'PY' 2>/dev/null
import json
import os
import time

state_file = os.environ.get("STATE_FILE", "")
category = os.environ.get("CATEGORY", "")

try:
    window = int(os.environ.get("DEBOUNCE_SECONDS", "5"))
except Exception:
    window = 5

if not state_file or not category:
    raise SystemExit(0)

try:
    os.makedirs(os.path.dirname(state_file), exist_ok=True)
except Exception:
    pass

now = int(time.time())
state = {}

try:
    with open(state_file, "a+", encoding="utf-8") as handle:
        try:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        except Exception:
            pass

        handle.seek(0)
        raw = handle.read().strip()
        if raw:
            try:
                state = json.loads(raw)
            except Exception:
                state = {}

        last = state.get(category)
        if isinstance(last, (int, float)) and now - int(last) < window:
            print("skip")
            raise SystemExit(0)

        state[category] = now
        handle.seek(0)
        handle.truncate()
        json.dump(state, handle, ensure_ascii=False)
        handle.write("\n")
        print("trigger")
except Exception:
    print("skip")
PY
)

[ "$SHOULD_TRIGGER" = "trigger" ] || exit 0

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
spawn_sync "$category" "$file_path"

exit 0
