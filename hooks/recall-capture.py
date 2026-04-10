#!/usr/bin/env python3
"""
Minimal recall capture hook for Stop.

Contract:
- Reads session context from Stop hook stdin.
- Appends one deterministic short recall entry per transcript version to
  ~/.claude/recall/entries.jsonl (append-only store).
- Does NOT write notes/tasks/memory bodies.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HOME = Path.home()
RECALL_DIR = Path(os.environ.get("CLAUDE_RECALL_DIR", str(HOME / ".claude" / "recall")))
RECALL_STORE = RECALL_DIR / "entries.jsonl"


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def parse_input() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def get_session_id(payload: dict[str, Any]) -> str:
    return str(payload.get("session_id") or payload.get("sessionId") or "").strip()


def get_transcript_path(payload: dict[str, Any]) -> Path | None:
    path = str(payload.get("transcript_path") or payload.get("transcriptPath") or "").strip()
    if not path:
        fallback = HOME / ".claude" / "history.jsonl"
        return fallback if fallback.exists() else None
    p = Path(path)
    return p if p.exists() else None


def normalize_text(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def extract_text_blocks(msg: dict[str, Any]) -> list[str]:
    out: list[str] = []
    inner = msg.get("message", {})
    if isinstance(inner, dict):
        content = inner.get("content", "")
        if isinstance(content, str) and content.strip():
            out.append(content.strip())
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") != "text":
                    continue
                txt = block.get("text") or block.get("content") or ""
                if isinstance(txt, str) and txt.strip():
                    out.append(txt.strip())

    display = msg.get("display")
    if isinstance(display, str) and display.strip():
        out.append(display.strip())
    return out


def system_noise(text: str) -> bool:
    if text.startswith("<command-message>") or text.startswith("<task-notification>"):
        return True
    if text.startswith("Stop hook feedback:"):
        return True
    if text.startswith("Run:\n\n```bash\n"):
        return True
    if "Raw slash-command arguments:" in text:
        return True
    return False


def infer_role(msg: dict[str, Any]) -> str:
    msg_type = str(msg.get("type") or "").strip().lower()
    if msg_type in {"user", "assistant"}:
        return msg_type

    role = msg.get("role")
    if isinstance(role, str):
        normalized = role.strip().lower()
        if normalized in {"user", "assistant"}:
            return normalized

    inner = msg.get("message")
    if isinstance(inner, dict):
        inner_role = inner.get("role")
        if isinstance(inner_role, str):
            normalized = inner_role.strip().lower()
            if normalized in {"user", "assistant"}:
                return normalized
    return ""


def parse_transcript(transcript_path: Path, session_id: str) -> tuple[str, list[str], str, list[str]]:
    last_user = ""
    last_assistant = ""
    recent_user_texts: list[str] = []
    recent_assistant_texts: list[str] = []

    try:
        with transcript_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(msg, dict):
                    continue

                msg_session = str(msg.get("sessionId") or msg.get("session_id") or "")
                if session_id and msg_session and msg_session != session_id:
                    continue

                blocks = extract_text_blocks(msg)
                role = infer_role(msg)
                for text in blocks:
                    if not text or system_noise(text):
                        continue
                    if role == "assistant":
                        last_assistant = text
                        recent_assistant_texts.append(text)
                        if len(recent_assistant_texts) > 8:
                            recent_assistant_texts.pop(0)
                        continue
                    # Unknown role defaults to user-like intent signal.
                    last_user = text
                    recent_user_texts.append(text)
                    if len(recent_user_texts) > 8:
                        recent_user_texts.pop(0)
    except OSError:
        return "", [], "", []

    return last_user, recent_user_texts, last_assistant, recent_assistant_texts


def extract_keywords(texts: list[str]) -> list[str]:
    bucket: list[str] = []
    seen: set[str] = set()
    for text in texts:
        for token in re.findall(r"[A-Za-z0-9_./-]{2,}", text.lower()):
            if token in seen:
                continue
            seen.add(token)
            bucket.append(token)
            if len(bucket) >= 10:
                return bucket
    return bucket


def extract_file_tokens(texts: list[str]) -> list[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    for text in texts:
        matches = re.findall(r"(~?/?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,8})", text)
        for token in matches:
            normalized = token.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            tokens.append(normalized)
            if len(tokens) >= 6:
                return tokens
    return tokens


def extract_command_tokens(texts: list[str]) -> list[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    pattern = re.compile(
        r"\b(?:git|python3?|pip|npm|pnpm|yarn|node|pytest|bash|zsh|sed|rg|ls|cat|grep|find|make|cargo|go|uv|docker|kubectl|ttadk|claude|codex)\b(?:\s+[A-Za-z0-9_./:-]+){0,3}",
        flags=re.IGNORECASE,
    )
    for text in texts:
        for match in pattern.findall(text):
            normalized = normalize_text(match.lower().rstrip(".,;:!?"), 48)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            tokens.append(normalized)
            if len(tokens) >= 6:
                return tokens
    return tokens


def build_summary(intent: str, outcome: str, files: list[str], commands: list[str]) -> str:
    intent_part = normalize_text(intent, 72) if intent else "unspecified intent"
    outcome_part = normalize_text(outcome, 72) if outcome else "no assistant outcome clue"
    files_part = ",".join(files[:2]) if files else "-"
    commands_part = ",".join(commands[:2]) if commands else "-"
    raw = f"Intent: {intent_part} | Outcome: {outcome_part} | Clues: files={files_part}; cmds={commands_part}"
    return normalize_text(raw, 180)


def resolve_current_task_dir() -> str:
    current = HOME / ".claude" / "tasks" / "current"
    try:
        if current.exists():
            return str(current.resolve())
    except OSError:
        return ""
    return ""


def entry_exists(entry_id: str) -> bool:
    if not RECALL_STORE.exists():
        return False
    try:
        with RECALL_STORE.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(item, dict) and str(item.get("entry_id", "")) == entry_id:
                    return True
    except OSError:
        return False
    return False


def append_entry(entry: dict[str, Any]) -> None:
    RECALL_DIR.mkdir(parents=True, exist_ok=True)
    with RECALL_STORE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def main() -> None:
    payload = parse_input()
    session_id = get_session_id(payload)
    transcript_path = get_transcript_path(payload)

    if not session_id or transcript_path is None:
        emit({})
        return

    try:
        transcript_mtime = int(transcript_path.stat().st_mtime)
    except OSError:
        emit({})
        return

    entry_id = f"{session_id}:{transcript_mtime}"
    if entry_exists(entry_id):
        emit({})
        return

    last_user, user_tail, last_assistant, assistant_tail = parse_transcript(transcript_path, session_id)
    file_tokens = extract_file_tokens(user_tail + assistant_tail)
    command_tokens = extract_command_tokens(user_tail + assistant_tail)
    summary = build_summary(last_user, last_assistant, file_tokens, command_tokens)
    keywords = extract_keywords(user_tail + assistant_tail + file_tokens + command_tokens)
    task_dir = resolve_current_task_dir()

    entry = {
        "schema": "recall.entry.v2",
        "entry_id": entry_id,
        "session_id": session_id,
        "captured_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "transcript_mtime": transcript_mtime,
        "summary": summary,
        "intent": normalize_text(last_user, 96) if last_user else "",
        "assistant_outcome": normalize_text(last_assistant, 96) if last_assistant else "",
        "action_hints": {
            "file_tokens": file_tokens,
            "command_tokens": command_tokens,
        },
        "keywords": keywords,
        "pointer": {
            "session_id": session_id,
            "transcript_path": str(transcript_path),
            "task_dir": task_dir,
        },
    }
    append_entry(entry)
    emit({})


if __name__ == "__main__":
    main()
