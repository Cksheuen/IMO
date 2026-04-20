#!/bin/bash
# Task bootstrap helper.
# Creates a minimal task directory for the current session if one does not exist.

set -u

INPUT=$(cat)

json_get() {
  local expr=${1:?}
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq -r "$expr // empty" 2>/dev/null
  else
    printf ''
  fi
}

resolve_tasks_root() {
  local project_root dir

  if project_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    if [ "$(basename "$project_root")" = ".claude" ]; then
      printf '%s/tasks\n' "$project_root"
    else
      printf '%s/.claude/tasks\n' "$project_root"
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

SESSION_ID=$(json_get '.session_id')
TRANSCRIPT_PATH=$(json_get '.transcript_path')
TASKS_ROOT=$(resolve_tasks_root)
CURRENT_LINK="$TASKS_ROOT/current"
CURRENT_FEATURE_LIST="$CURRENT_LINK/feature-list.json"

mkdir -p "$TASKS_ROOT"

if [ -n "$SESSION_ID" ] && [ -f "$CURRENT_FEATURE_LIST" ]; then
  CURRENT_SESSION=$(jq -r '.session_id // empty' "$CURRENT_FEATURE_LIST" 2>/dev/null)
  if [ -n "$CURRENT_SESSION" ] && [ "$CURRENT_SESSION" = "$SESSION_ID" ]; then
    printf '%s\n' "$(cd "$CURRENT_LINK" 2>/dev/null && pwd -P)"
    exit 0
  fi
fi

BOOTSTRAP_JSON=$(python3 - "$TASKS_ROOT" "$PWD" "$SESSION_ID" "$TRANSCRIPT_PATH" <<'PYEOF'
import datetime as dt
import json
import re
import sys
from pathlib import Path

tasks_root = Path(sys.argv[1])
cwd = Path(sys.argv[2])
session_id = sys.argv[3].strip()
transcript_path = sys.argv[4].strip()


def load_last_user_message(path_str: str, target_session: str) -> str:
    if not path_str:
        return ""
    path = Path(path_str)
    if not path.is_file():
        return ""

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""

    user_messages = []
    for raw_line in lines:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            msg = json.loads(raw_line)
        except json.JSONDecodeError:
            continue

        msg_session = msg.get("sessionId") or msg.get("session_id")
        if target_session and msg_session and msg_session != target_session:
            continue

        if msg.get("type") == "user":
            inner = msg.get("message", {})
            content = inner.get("content", "") if isinstance(inner, dict) else ""
            if isinstance(content, str) and content.strip():
                user_messages.append(content.strip())
                continue
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text":
                        text = (block.get("text") or block.get("content") or "").strip()
                        if text:
                            user_messages.append(text)
                continue

        display = msg.get("display")
        if isinstance(display, str) and display.strip() and not display.startswith("<"):
            user_messages.append(display.strip())

    for message in reversed(user_messages):
        if "<command-message>" in message or "<task-notification>" in message:
            continue
        return message
    return ""


def normalize_title(text: str, fallback: str) -> str:
    text = re.sub(r"[~]{3}.*?[~]{3}", " ", text, flags=re.S)
    text = re.sub(r"\b[a-zA-Z0-9_./-]+\b", lambda m: m.group(0), text)
    text = re.sub(r"\s+", " ", text).strip(" -:#\n\t")
    if not text:
        return fallback
    line = text.splitlines()[0].strip()
    return line[:120] if line else fallback


def make_slug(title: str, session: str) -> str:
    ascii_words = re.findall(r"[A-Za-z0-9]+", title.lower())
    stop = {
        "the", "a", "an", "to", "for", "of", "and", "or", "in", "on", "with",
        "is", "are", "be", "this", "that", "it", "do", "does", "did", "check",
        "fix", "issue", "task", "please", "help", "why", "what", "how"
    }
    filtered = [w for w in ascii_words if w not in stop]
    words = filtered[:6] or ascii_words[:6]
    if words:
        slug = "-".join(words)
    else:
        token = re.sub(r"[^a-z0-9]", "", session.lower())[:8]
        slug = f"draft-task-{token or 'session'}"
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or f"draft-task-{(session or 'session')[:8]}"


user_message = load_last_user_message(transcript_path, session_id)
fallback_title = f"Task bootstrap for session {session_id[:8] or 'unknown'}"
title = normalize_title(user_message, fallback_title)
slug = make_slug(title, session_id)
today = dt.date.today().isoformat()
base_dir = f"{today}-{slug}"
task_dir = tasks_root / base_dir

if task_dir.exists():
    token = re.sub(r"[^a-z0-9]", "", session_id.lower())[:8] or "session"
    task_dir = tasks_root / f"{base_dir}-{token}"

created_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

payload = {
    "task_dir": str(task_dir),
    "task_id": task_dir.name,
    "created_at": created_at,
    "session_id": session_id,
    "title": title,
    "summary": user_message or title,
    "cwd": str(cwd),
}

print(json.dumps(payload, ensure_ascii=False))
PYEOF
)

TASK_DIR=$(printf '%s' "$BOOTSTRAP_JSON" | jq -r '.task_dir')
TASK_ID=$(printf '%s' "$BOOTSTRAP_JSON" | jq -r '.task_id')
CREATED_AT=$(printf '%s' "$BOOTSTRAP_JSON" | jq -r '.created_at')
TITLE=$(printf '%s' "$BOOTSTRAP_JSON" | jq -r '.title')
SUMMARY=$(printf '%s' "$BOOTSTRAP_JSON" | jq -r '.summary')

mkdir -p "$TASK_DIR"

PRD_FILE="$TASK_DIR/prd.md"
CONTEXT_FILE="$TASK_DIR/context.md"
STATUS_FILE="$TASK_DIR/status.md"
FEATURE_LIST_FILE="$TASK_DIR/feature-list.json"

if [ ! -f "$PRD_FILE" ]; then
  cat <<EOF > "$PRD_FILE"
# PRD

- Task: $TITLE
- Created At: $CREATED_AT
- Session ID: ${SESSION_ID:-unknown}

## Goal

$SUMMARY

## Scope

- Capture the current task intent before implementation starts
- Keep execution state and verification state under this task directory

## Acceptance Criteria

- The task intent is recorded in this directory before implementation proceeds
- Relevant context and execution status can be updated incrementally during the task
- Verification status is tracked in feature-list.json

## Non-Goals

- Long-term reusable knowledge that belongs in notes/
- Detailed implementation results before execution has started
EOF
fi

if [ ! -f "$CONTEXT_FILE" ]; then
  cat <<EOF > "$CONTEXT_FILE"
# Context

- Task ID: $TASK_ID
- Session ID: ${SESSION_ID:-unknown}
- Working Directory: $PWD
- Tasks Root: $TASKS_ROOT
- Bootstrap Time: $CREATED_AT

## Background

- Initial user request: $SUMMARY
- This directory was bootstrapped automatically before the first edit/write action in the session.

## Related Paths

- Current working directory: $PWD
- Current task link target: $TASK_DIR
EOF
fi

if [ ! -f "$STATUS_FILE" ]; then
  cat <<EOF > "$STATUS_FILE"
# Status

- State: bootstrapped
- Created At: $CREATED_AT
- Session ID: ${SESSION_ID:-unknown}

## Current Progress

- Task directory created
- Initial PRD / context / status / feature list seeded

## Next Step

- Complete scale assessment
- Refine acceptance criteria if the task scope becomes clearer
- Execute the implementation or analysis work

## Blockers

- None at bootstrap time
EOF
fi

if [ ! -f "$FEATURE_LIST_FILE" ]; then
  python3 - "$FEATURE_LIST_FILE" "$TASK_ID" "$CREATED_AT" "$SESSION_ID" "$TITLE" <<'PYEOF'
import json
import sys

path, task_id, created_at, session_id, title = sys.argv[1:6]
payload = {
    "task_id": task_id,
    "created_at": created_at,
    "session_id": session_id,
    "status": "in_progress",
    "features": [
        {
            "id": "F001",
            "category": "task",
            "description": title,
            "acceptance_criteria": [
                "Task intent is captured in the task directory before execution continues",
                "Execution and verification status can be tracked from this task directory",
                "The task is explicitly verified or marked completed before the session ends"
            ],
            "verification_method": "manual",
            "passes": None,
            "verified_at": None,
            "attempt_count": 0,
            "max_attempts": 3,
            "notes": "Bootstrapped automatically by scale-gate",
            "delta_context": None
        }
    ],
    "summary": {
        "total": 1,
        "passed": 0,
        "pending": 1
    }
}

with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PYEOF
fi

ln -sfn "$TASK_DIR" "$CURRENT_LINK"
printf '%s\n' "$TASK_DIR"
