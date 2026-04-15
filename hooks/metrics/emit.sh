#!/bin/bash

# Fire-and-forget metrics emit helpers for bash hooks.
# Never write to stdout/stderr; never affect caller exit behavior.

metrics_now_ms() {
  python3 - <<'PY' 2>/dev/null || printf '0\n'
import time
print(int(time.monotonic() * 1000))
PY
}

metrics_emit() {
  local _m_hook_id="${1:-}"
  local _m_hook_event="${2:-}"
  local _m_event="${3:-hook_run}"
  local _m_status="${4:-ok}"
  local _m_duration_ms="${5:-}"
  local _m_meta_json="${6:-}"
  local _m_claude_home="${CLAUDE_HOME:-$HOME/.claude}"
  local _m_session_id="${METRICS_SESSION_ID:-unknown}"
  local _m_scope="${METRICS_SCOPE:-global}"
  local _m_source="${METRICS_SOURCE:-cc}"
  local _m_cwd_value="${METRICS_CWD:-$PWD}"

  [ -n "$_m_hook_id" ] || return 0
  [ -n "$_m_hook_event" ] || return 0

  python3 - "$_m_claude_home" "$_m_hook_id" "$_m_hook_event" "$_m_event" "$_m_status" "$_m_duration_ms" "$_m_meta_json" "$_m_session_id" "$_m_scope" "$_m_source" "$_m_cwd_value" >/dev/null 2>&1 <<'PY' || true
import json
import sys
from datetime import datetime
from pathlib import Path

claude_home, hook_id, hook_event, event, status, duration_ms, meta_json, session_id, scope, source, cwd_value = sys.argv[1:12]

metrics_dir = Path(claude_home) / "metrics" / "events"
metrics_dir.mkdir(parents=True, exist_ok=True)

now = datetime.now().astimezone()
date_str = now.strftime("%Y-%m-%d")
record = {
    "ts": now.isoformat(timespec="seconds"),
    "date": date_str,
    "session_id": session_id or "unknown",
    "event": event or "hook_run",
    "hook_id": hook_id,
    "hook_event": hook_event,
    "status": status or "ok",
    "source": source or "cc",
    "scope": scope or "global",
    "cwd": cwd_value,
}

if duration_ms:
    try:
        record["duration_ms"] = max(0, int(duration_ms))
    except ValueError:
        pass

if meta_json:
    try:
        meta = json.loads(meta_json)
    except Exception:
        meta = None
    if meta is not None:
        record["meta"] = meta

with (metrics_dir / f"{date_str}.jsonl").open("a", encoding="utf-8") as fh:
    fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
PY
}
