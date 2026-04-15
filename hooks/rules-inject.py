#!/usr/bin/env python3
"""UserPromptSubmit hook for on-demand rule injection."""

from __future__ import annotations

import json
import signal
import sys
import time
import importlib.util
from pathlib import Path
from typing import Any

CLAUDE_DIR = Path.home() / ".claude"
INDEX_PATH = CLAUDE_DIR / "rules-index.json"
MAX_RULES = 3
MAX_TOTAL_SIZE = 30 * 1024
STRONG_WEIGHT = 3
WEAK_WEIGHT = 1
LARGE_RULE_THRESHOLD = 5000
LARGE_RULE_MIN_SCORE = 6
METRICS_EMIT_PATH = Path.home() / ".claude" / "hooks" / "metrics" / "emit.py"


class HookTimeout(Exception):
    """Raised when the hook exceeds its runtime budget."""


def on_timeout(signum: int, frame: Any) -> None:
    raise HookTimeout


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def load_metrics_emit():
    if not METRICS_EMIT_PATH.exists():
        return None
    spec = importlib.util.spec_from_file_location("metrics_emit", METRICS_EMIT_PATH)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, "emit_event", None)


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

        strong_keywords = entry.get("strong_keywords")
        weak_keywords = entry.get("keywords")

        # Backward compat: old index without strong_keywords
        if not isinstance(strong_keywords, list):
            if not isinstance(weak_keywords, list):
                continue
            matched = {
                kw for kw in weak_keywords
                if isinstance(kw, str) and kw and kw in lowered
            }
            if matched:
                ranked.append((len(matched), entry))
            continue

        if not isinstance(weak_keywords, list):
            weak_keywords = []

        strong_matched = sum(
            1 for kw in strong_keywords
            if isinstance(kw, str) and kw and kw in lowered
        )
        weak_matched = sum(
            1 for kw in weak_keywords
            if isinstance(kw, str) and kw and kw in lowered
        )

        # Gate: must hit at least 1 strong keyword
        if strong_matched == 0:
            continue

        score = strong_matched * STRONG_WEIGHT + weak_matched * WEAK_WEIGHT

        # Large rules need higher score
        size = entry.get("size_bytes", 0)
        if isinstance(size, (int, float)) and size > LARGE_RULE_THRESHOLD:
            if score < LARGE_RULE_MIN_SCORE:
                continue

        ranked.append((score, entry))

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
    emit_event = load_metrics_emit()
    start = time.monotonic()
    session_id = ""
    response: dict[str, Any] = {}
    status = "ok"
    meta: dict[str, Any] = {"rules_injected": 0}

    signal.signal(signal.SIGALRM, on_timeout)
    signal.alarm(10)
    try:
        payload = parse_payload()
        session_id = str(payload.get("session_id") or payload.get("sessionId") or "").strip()
        prompt = payload.get("prompt", "")
        if not isinstance(prompt, str) or not prompt.strip():
            return 0

        ranked = match_entries(prompt, load_index())
        selected = select_contents(ranked)
        if not selected:
            return 0

        header = f"## On-Demand Rules Injected ({len(selected)} rules matched)"
        meta["rules_injected"] = len(selected)
        response = {"additionalContext": header + "\n\n" + "\n\n---\n\n".join(selected)}
        return 0
    except Exception:
        status = "error"
        response = {}
        return 0
    finally:
        signal.alarm(0)
        if callable(emit_event):
            emit_event(
                hook_id="rules-inject",
                hook_event="UserPromptSubmit",
                event="hook_run",
                status=status,
                duration_ms=int((time.monotonic() - start) * 1000),
                session_id=session_id,
                scope="global",
                meta=meta,
            )
        emit(response)


if __name__ == "__main__":
    raise SystemExit(main())
