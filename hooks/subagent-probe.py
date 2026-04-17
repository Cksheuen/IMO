#!/usr/bin/env python3
"""Subagent probe hook.

Records Task/Agent hook payload samples to JSONL without affecting runtime
behavior. All failure paths must exit 0.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
LOG_DIR = CLAUDE_DIR / "logs"
LOG_FILE = LOG_DIR / "subagent-probe.jsonl"
ROTATED_FILE = LOG_DIR / "subagent-probe.jsonl.1"
MAX_LOG_BYTES = 10 * 1024 * 1024
PROMPT_HEAD_LIMIT_BYTES = 500
HOME_DIR = os.environ.get("HOME", "")
HOME_PREFIX_RE = (
    re.compile(rf"{re.escape(HOME_DIR)}(?=/|$)") if HOME_DIR else None
)
EMAIL_RE = re.compile(r"\b[\w._%+-]+@[\w.-]+\.\w+\b")
OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")
GITHUB_TOKEN_RE = re.compile(r"\bghp_[A-Za-z0-9]{36,}\b")
AWS_ACCESS_KEY_RE = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
BEARER_TOKEN_RE = re.compile(r"Bearer\s+[\w\-.]+")
SANITIZE_RULES = [
    (HOME_PREFIX_RE, "$HOME"),
    (EMAIL_RE, "[REDACTED:EMAIL]"),
    (OPENAI_KEY_RE, "[REDACTED:OPENAI_KEY]"),
    (GITHUB_TOKEN_RE, "[REDACTED:GITHUB_TOKEN]"),
    (AWS_ACCESS_KEY_RE, "[REDACTED:AWS_KEY]"),
    (BEARER_TOKEN_RE, "Bearer [REDACTED]"),
]


def load_payload() -> dict | None:
    try:
        raw = sys.stdin.buffer.read()
    except Exception:
        return None

    if not raw or not raw.strip():
        return None

    try:
        payload = json.loads(raw)
    except Exception:
        return None

    return payload if isinstance(payload, dict) else None


def get_tool_input(payload: dict) -> dict:
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        return tool_input

    tool_input = payload.get("toolInput")
    return tool_input if isinstance(tool_input, dict) else {}


def prompt_head(prompt: str) -> str:
    if not isinstance(prompt, str) or not prompt:
        return ""

    data = prompt.encode("utf-8", "ignore")[:PROMPT_HEAD_LIMIT_BYTES]
    return data.decode("utf-8", "ignore")


def sanitize(text: str) -> str:
    if not isinstance(text, str) or not text:
        return ""

    sanitized = text
    for pattern, replacement in SANITIZE_RULES:
        if pattern is None:
            continue

        while True:
            updated = pattern.sub(replacement, sanitized)
            if updated == sanitized:
                break
            sanitized = updated

    return sanitized


def current_task_path() -> str:
    current = CLAUDE_DIR / "tasks" / "current"
    if not current.exists() and not current.is_symlink():
        return ""

    try:
        return str(current.resolve(strict=False))
    except Exception:
        try:
            return str(current)
        except Exception:
            return ""


def rotate_if_needed(pending_bytes: int) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        return

    try:
        current_size = LOG_FILE.stat().st_size if LOG_FILE.exists() else 0
    except Exception:
        current_size = 0

    if current_size <= MAX_LOG_BYTES and current_size + pending_bytes <= MAX_LOG_BYTES:
        return

    try:
        if ROTATED_FILE.exists() or ROTATED_FILE.is_symlink():
            ROTATED_FILE.unlink()
    except Exception:
        pass

    try:
        if LOG_FILE.exists():
            os.replace(LOG_FILE, ROTATED_FILE)
    except Exception:
        pass


def append_record(record: dict) -> None:
    try:
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    except Exception:
        return

    encoded = line.encode("utf-8", "ignore")
    rotate_if_needed(len(encoded))

    try:
        with LOG_FILE.open("ab") as handle:
            handle.write(encoded)
    except Exception:
        return


def main() -> None:
    payload = load_payload()
    if not payload:
        return

    tool_input = get_tool_input(payload)
    prompt = tool_input.get("prompt", "")

    record = {
        "timestamp": datetime.now().astimezone().isoformat(timespec="seconds"),
        "session_id": payload.get("session_id") or payload.get("sessionId") or "",
        "subagent_type": tool_input.get("subagent_type", "") or "",
        "prompt_head": sanitize(prompt_head(prompt if isinstance(prompt, str) else "")),
        "parent_task": sanitize(current_task_path()),
        "cwd": sanitize(payload.get("cwd", "") or ""),
    }
    append_record(record)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    raise SystemExit(0)
