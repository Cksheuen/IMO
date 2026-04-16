#!/usr/bin/env python3
"""
Minimal recall query hook for UserPromptSubmit.

Contract (minimal):
- Reads `.prompt` from hook stdin JSON.
- Searches ONLY ~/.claude/recall/entries.jsonl.
- Emits short `hookSpecificOutput.additionalContext` with hard char budget.
- Returns summary + pointers only (no transcript/raw note injection).
- Dedupes matches at session granularity before returning top-k.
"""

from __future__ import annotations

import json
import os
import re
import sys
import importlib.util
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RECALL_STORE = Path(
    os.environ.get("CLAUDE_RECALL_STORE", str(Path.home() / ".claude" / "recall" / "entries.jsonl"))
)
CONTEXT_BUNDLE = Path.home() / ".claude" / "hooks" / "context-bundle.py"
METRICS_EMIT_PATH = Path.home() / ".claude" / "hooks" / "metrics" / "emit.py"
EXPLICIT_DEFAULT_K = 2
AUTO_DEFAULT_K = 1
MAX_K = 4
EXPLICIT_DEFAULT_BUDGET_CHARS = 360
AUTO_DEFAULT_BUDGET_CHARS = 220
MIN_BUDGET_CHARS = 120
MAX_BUDGET_CHARS = 800
AUTO_MIN_SCORE = 6

AUTO_SIGNAL_PATTERNS = (
    r"\bwhere\s+were\s+we\b",
    r"\blast\s+time\b",
    r"\bprevious\s+session\b",
    r"\bresume\s+(the\s+)?context\b",
    r"\bcontinue\s+(the\s+)?(session|context|task)\b",
    r"\bpick\s+up\s+where\s+we\s+left\s+off\b",
    r"\brestore\s+(the\s+)?context\b",
    r"\blost\s+context\b",
    r"\brecovery\b",
    r"恢复上下文",
    r"恢复会话",
    r"继续上次",
    r"接着上次",
    r"中断后",
    r"上次",
    r"刚才那个",
)


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _load_context_bundle():
    if not CONTEXT_BUNDLE.exists():
        return None
    spec = importlib.util.spec_from_file_location("context_bundle", CONTEXT_BUNDLE)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_metrics_emit():
    if not METRICS_EMIT_PATH.exists():
        return None
    spec = importlib.util.spec_from_file_location("metrics_emit", METRICS_EMIT_PATH)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, "emit_event", None)


def parse_stdin_json() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def normalize_text(text: str, limit: int) -> str:
    collapsed = re.sub(r"\s+", " ", text or "").strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: max(0, limit - 1)].rstrip() + "…"


def has_explicit_recall_query(prompt: str) -> bool:
    return bool(re.search(r"\brecall\.query\b", prompt, flags=re.IGNORECASE))


def should_auto_recall(prompt: str) -> bool:
    normalized = prompt.strip()
    if not normalized:
        return False
    for pattern in AUTO_SIGNAL_PATTERNS:
        if re.search(pattern, normalized, flags=re.IGNORECASE):
            return True
    return False


def parse_explicit_recall_query_contract(prompt: str) -> tuple[str, int, int]:
    """
    Optional compact contract in prompt:
      recall.query query="..." k=2 budget_chars=300
    Fallback:
      query = the trailing text after `recall.query`,
      or full prompt if no trailing text exists.
    """
    query = prompt.strip()
    k = EXPLICIT_DEFAULT_K
    budget = EXPLICIT_DEFAULT_BUDGET_CHARS

    m_tail = re.search(r"\brecall\.query\b(.*)$", prompt, flags=re.IGNORECASE | re.DOTALL)
    if m_tail:
        query = m_tail.group(1).strip() or query

    m_query = re.search(r'query\s*=\s*"([^"]+)"', prompt, flags=re.IGNORECASE | re.DOTALL)
    if not m_query:
        m_query = re.search(r"query\s*=\s*'([^']+)'", prompt, flags=re.IGNORECASE | re.DOTALL)
    if m_query:
        query = m_query.group(1).strip() or query

    m_k = re.search(r"\bk\s*=\s*(\d+)\b", prompt, flags=re.IGNORECASE)
    if m_k:
        k = int(m_k.group(1))

    m_budget = re.search(r"\bbudget_chars\s*=\s*(\d+)\b", prompt, flags=re.IGNORECASE)
    if m_budget:
        budget = int(m_budget.group(1))

    return query, k, budget


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def tokenize(query: str) -> list[str]:
    # Keep this intentionally simple and deterministic.
    terms = re.findall(r"[a-zA-Z0-9_./-]{2,}", query.lower())
    dedup: list[str] = []
    seen: set[str] = set()
    for t in terms:
        if t in seen:
            continue
        seen.add(t)
        dedup.append(t)
    return dedup[:12]


def parse_iso_utc(value: str) -> datetime:
    if not value:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return datetime.fromtimestamp(0, tz=timezone.utc)


def load_entries() -> list[dict[str, Any]]:
    if not RECALL_STORE.exists():
        return []

    entries: list[dict[str, Any]] = []
    try:
        for raw in RECALL_STORE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                entries.append(item)
    except OSError:
        return []
    return entries


def entry_score(entry: dict[str, Any], query: str, query_terms: list[str]) -> int:
    summary = str(entry.get("summary", ""))
    intent = str(entry.get("intent", ""))
    assistant_outcome = str(entry.get("assistant_outcome", ""))
    keywords = entry.get("keywords", [])
    keywords_text = " ".join(k for k in keywords if isinstance(k, str))
    action_hints = entry.get("action_hints", {})
    action_hint_text = json.dumps(action_hints, ensure_ascii=False) if isinstance(action_hints, dict) else ""
    pointer = entry.get("pointer", {})
    pointer_text = json.dumps(pointer, ensure_ascii=False) if isinstance(pointer, dict) else ""
    haystack = f"{summary} {intent} {assistant_outcome} {keywords_text} {action_hint_text} {pointer_text}".lower()

    score = 0
    for term in query_terms:
        if term in haystack:
            score += 3

    q = query.lower().strip()
    if q and q in haystack:
        score += 4

    created_at = str(entry.get("captured_at", ""))
    age_days = (datetime.now(timezone.utc) - parse_iso_utc(created_at)).days
    if age_days <= 7:
        score += 2
    elif age_days <= 30:
        score += 1
    return score


def pick_entries(entries: list[dict[str, Any]], query: str, k: int) -> tuple[list[dict[str, Any]], int]:
    query_terms = tokenize(query)
    ranked: list[tuple[int, datetime, dict[str, Any]]] = []
    for entry in entries:
        score = entry_score(entry, query, query_terms)
        if score <= 0:
            continue
        ts = parse_iso_utc(str(entry.get("captured_at", "")))
        ranked.append((score, ts, entry))

    # Session-level dedupe: keep only the best match per session.
    best_by_session: dict[str, tuple[int, datetime, dict[str, Any]]] = {}
    for score, ts, entry in ranked:
        pointer = entry.get("pointer", {})
        pointer_session = pointer.get("session_id") if isinstance(pointer, dict) else ""
        session_id = str(entry.get("session_id") or pointer_session or "").strip()
        key = session_id or str(entry.get("entry_id") or "")
        existing = best_by_session.get(key)
        if existing is None or (score, ts) > (existing[0], existing[1]):
            best_by_session[key] = (score, ts, entry)

    deduped = list(best_by_session.values())
    deduped.sort(key=lambda item: (item[0], item[1]), reverse=True)
    top_score = deduped[0][0] if deduped else 0
    return [item[2] for item in deduped[:k]], top_score


def pointer_brief(entry: dict[str, Any]) -> str:
    pointer = entry.get("pointer", {})
    if not isinstance(pointer, dict):
        pointer = {}
    session_id = str(pointer.get("session_id") or entry.get("session_id") or "-")
    task_dir = str(pointer.get("task_dir") or "")
    task_name = Path(task_dir).name if task_dir else "-"
    transcript_path = str(pointer.get("transcript_path") or "")
    transcript_name = Path(transcript_path).name if transcript_path else "-"
    session_id = normalize_text(session_id, 24) or "-"
    task_name = normalize_text(task_name, 32) if task_name != "-" else "-"
    transcript_name = normalize_text(transcript_name, 24) if transcript_name != "-" else "-"
    return f"session={session_id} task={task_name} transcript={transcript_name}"


def build_context(entries: list[dict[str, Any]], budget_chars: int) -> str:
    header = "Recall hints (local recall store only):\n"
    footer = "\n(short summaries + pointers only)"
    room = budget_chars - len(header) - len(footer)
    if room < 40:
        return ""

    chunks: list[str] = []
    for idx, entry in enumerate(entries, start=1):
        summary = normalize_text(str(entry.get("summary", "")), 110)
        if not summary:
            continue
        block = f"{idx}. {summary}\n   pointer: {pointer_brief(entry)}"
        if len(block) > room and not chunks:
            compact_pointer = normalize_text(pointer_brief(entry), 56)
            compact_summary_limit = max(24, room - len(f"{idx}. \n   pointer: {compact_pointer}") - 4)
            compact_summary = normalize_text(summary, compact_summary_limit)
            block = f"{idx}. {compact_summary}\n   pointer: {compact_pointer}"
        projected = len("\n".join(chunks + [block]))
        if projected > room:
            break
        chunks.append(block)

    if not chunks:
        return ""

    text = header + "\n".join(chunks) + footer
    if len(text) > budget_chars:
        text = text[: budget_chars - 1].rstrip() + "…"
    return text


def main() -> None:
    emit_event = load_metrics_emit()
    start = time.monotonic()
    response: dict[str, Any] = {}
    session_id = ""
    status = "ok"
    meta: dict[str, Any] = {"matched_count": 0}

    try:
        payload = parse_stdin_json()
        prompt = str(payload.get("prompt", "")).strip()
        session_id = str(payload.get("session_id") or payload.get("sessionId") or "").strip()
        if not prompt:
            return
        bundle = _load_context_bundle()
        if bundle is None:
            meta["bundle_loaded"] = False
            return
        build_additional_context_payload = getattr(bundle, "build_additional_context_payload", None)
        combine_contexts = getattr(bundle, "combine_contexts", None)
        load_declarative_context = getattr(bundle, "load_declarative_context", None)
        if not callable(build_additional_context_payload) or not callable(combine_contexts) or not callable(load_declarative_context):
            meta["bundle_loaded"] = False
            return

        meta["bundle_loaded"] = True
        declarative_context = load_declarative_context(session_id)
        recall_context = ""

        auto_mode = False
        if has_explicit_recall_query(prompt):
            query, k, budget = parse_explicit_recall_query_contract(prompt)
            meta["mode"] = "explicit"
        else:
            if not should_auto_recall(prompt):
                response = build_additional_context_payload(session_id=session_id, recall_context="")
                meta["mode"] = "none"
                return
            auto_mode = True
            query = prompt
            k = AUTO_DEFAULT_K
            budget = AUTO_DEFAULT_BUDGET_CHARS
            meta["mode"] = "auto"

        k = clamp(k, 1, MAX_K)
        budget = clamp(budget, MIN_BUDGET_CHARS, MAX_BUDGET_CHARS)

        results, top_score = pick_entries(load_entries(), query, k)
        meta["matched_count"] = len(results)
        meta["top_score"] = top_score
        if not results:
            response = build_additional_context_payload(session_id=session_id, recall_context="")
            return

        # Auto mode uses a stricter hit gate: weak fuzzy matches should not inject any recall.
        if auto_mode and top_score < AUTO_MIN_SCORE:
            response = build_additional_context_payload(session_id=session_id, recall_context="")
            meta["matched_count"] = 0
            meta["top_score"] = top_score
            return

        recall_context = build_context(results, budget)
        combined = combine_contexts(declarative_context, recall_context)
        if not combined:
            return

        meta["context_chars"] = len(recall_context)
        response = build_additional_context_payload(session_id=session_id, recall_context=recall_context)
    except Exception:
        status = "error"
        response = {}
    finally:
        if callable(emit_event):
            emit_event(
                hook_id="recall-entrypoint",
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
    main()
