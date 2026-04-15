#!/usr/bin/env python3
"""UserPromptSubmit hook for on-demand rule injection."""

from __future__ import annotations

import json
import signal
import sys
from pathlib import Path
from typing import Any

CLAUDE_DIR = Path.home() / ".claude"
INDEX_PATH = CLAUDE_DIR / "rules-index.json"
MAX_RULES = 3
MAX_TOTAL_SIZE = 30 * 1024


class HookTimeout(Exception):
    """Raised when the hook exceeds its runtime budget."""


def on_timeout(signum: int, frame: Any) -> None:
    raise HookTimeout


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def parse_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    data = json.loads(raw)
    return data if isinstance(data, dict) else {}


def load_index() -> list[dict[str, Any]]:
    data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def match_entries(prompt: str, entries: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    lowered = prompt.lower()
    ranked: list[tuple[int, dict[str, Any]]] = []
    for entry in entries:
        if entry.get("always_loaded") is True:
            continue
        keywords = entry.get("keywords")
        if not isinstance(keywords, list):
            continue
        matched = {
            keyword for keyword in keywords
            if isinstance(keyword, str) and keyword and keyword in lowered
        }
        if matched:
            ranked.append((len(matched), entry))
    ranked.sort(key=lambda item: (-item[0], str(item[1].get("path", ""))))
    return ranked


def select_contents(ranked: list[tuple[int, dict[str, Any]]]) -> list[str]:
    selected: list[str] = []
    total_size = 0
    for _, entry in ranked:
        if len(selected) >= MAX_RULES:
            break
        rel_path = entry.get("path")
        if not isinstance(rel_path, str) or not rel_path:
            continue
        abs_path = CLAUDE_DIR / rel_path
        try:
            content = abs_path.read_text(encoding="utf-8")
        except OSError:
            continue
        content_size = len(content.encode("utf-8"))
        if total_size + content_size > MAX_TOTAL_SIZE:
            continue
        selected.append(content)
        total_size += content_size
    return selected


def main() -> int:
    signal.signal(signal.SIGALRM, on_timeout)
    signal.alarm(10)
    try:
        payload = parse_payload()
        prompt = payload.get("prompt", "")
        if not isinstance(prompt, str) or not prompt.strip():
            emit({})
            return 0

        ranked = match_entries(prompt, load_index())
        selected = select_contents(ranked)
        if not selected:
            emit({})
            return 0

        header = f"## On-Demand Rules Injected ({len(selected)} rules matched)"
        emit({"additionalContext": header + "\n\n" + "\n\n---\n\n".join(selected)})
        return 0
    except Exception:
        emit({})
        return 0
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    raise SystemExit(main())
