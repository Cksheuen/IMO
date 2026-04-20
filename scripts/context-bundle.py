#!/usr/bin/env python3
"""Helpers for building hook additionalContext bundles.

This module intentionally does not query recall stores. It only handles:
1) declarative snapshot consumption
2) session cache/frozen semantics
3) context string combination for shared hook consumer paths
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from typing import Any

DECLARATIVE_RUNTIME = Path.home() / ".claude" / "memory" / "declarative" / "runtime.py"
DECLARATIVE_DEFAULT_BUDGET_CHARS = 220

SESSION_CACHE_PATH = Path(
    os.environ.get(
        "CLAUDE_DECLARATIVE_SESSION_CACHE",
        str(Path.home() / ".claude" / "recall" / "declarative-session-cache.json"),
    )
)


def _load_session_cache(path: Path = SESSION_CACHE_PATH) -> dict[str, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in payload.items():
        if isinstance(key, str) and isinstance(value, str):
            out[key] = value
    return out


def _save_session_cache(cache: dict[str, str], path: Path = SESSION_CACHE_PATH) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(cache, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
            encoding="utf-8",
        )
    except OSError:
        # Read path is fail-closed; cache write failures should not break hook flow.
        return


def _build_declarative_snapshot(budget_chars: int) -> str:
    if not DECLARATIVE_RUNTIME.exists():
        return ""
    try:
        spec = importlib.util.spec_from_file_location("declarative_runtime", DECLARATIVE_RUNTIME)
        if spec is None or spec.loader is None:
            return ""
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        builder = getattr(module, "build_snapshot", None)
        if not callable(builder):
            return ""
        snapshot = builder(budget_chars=budget_chars)
        if isinstance(snapshot, str) and snapshot.strip():
            return snapshot
    except Exception:
        return ""
    return ""


def load_declarative_context(
    session_id: str | None,
    budget_chars: int = DECLARATIVE_DEFAULT_BUDGET_CHARS,
    cache_path: Path = SESSION_CACHE_PATH,
) -> str:
    """Load declarative snapshot with session-frozen semantics.

    - with session_id: first successful load freezes snapshot for that session
    - without session_id: deterministic fallback, always recompute from runtime
    """
    sid = (session_id or "").strip()
    if not sid:
        return _build_declarative_snapshot(budget_chars)

    cache = _load_session_cache(cache_path)
    cached = cache.get(sid, "")
    if isinstance(cached, str) and cached.strip():
        return cached

    snapshot = _build_declarative_snapshot(budget_chars)
    if snapshot:
        cache[sid] = snapshot
        _save_session_cache(cache, cache_path)
    return snapshot


def combine_contexts(declarative_context: str, recall_context: str) -> str:
    parts = [part for part in (declarative_context, recall_context) if isinstance(part, str) and part.strip()]
    return "\n\n".join(parts)


def build_additional_context_payload(
    session_id: str | None,
    recall_context: str = "",
    declarative_budget_chars: int = DECLARATIVE_DEFAULT_BUDGET_CHARS,
    cache_path: Path = SESSION_CACHE_PATH,
) -> dict[str, Any]:
    declarative_context = load_declarative_context(
        session_id=session_id,
        budget_chars=declarative_budget_chars,
        cache_path=cache_path,
    )
    combined = combine_contexts(declarative_context, recall_context)
    if not combined:
        return {}
    return {"hookSpecificOutput": {"additionalContext": combined}}


__all__ = [
    "DECLARATIVE_DEFAULT_BUDGET_CHARS",
    "SESSION_CACHE_PATH",
    "build_additional_context_payload",
    "combine_contexts",
    "load_declarative_context",
]
