#!/usr/bin/env python3
"""UserPromptSubmit hook for on-demand rule injection."""

from __future__ import annotations

import json
import os
import signal
import sys
import time
import importlib.util
import subprocess
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
OPT_OUT_RULES = {
    "rules-library/pattern/agent-concept-flow.md": "concept-flow-config.json",
}
PROJECT_ROOT_MARKERS = (
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    ".git",
)


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
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        rules = data.get("rules")
        if isinstance(rules, list):
            return rules
    return []


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


def resolve_project_root(cwd: Path) -> Path | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
        )
        root = result.stdout.strip()
        if result.returncode == 0 and root:
            return Path(root).resolve()
    except Exception:
        pass

    try:
        current = cwd.resolve()
    except OSError:
        return None

    for candidate in (current, *current.parents):
        if any((candidate / marker).exists() for marker in PROJECT_ROOT_MARKERS):
            return candidate
    return None


def read_opt_out_enabled(config_path: Path) -> bool | None:
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data.get("enabled") is not False


def is_opt_out_rule_enabled(config_filename: str, cwd: Path | None) -> bool:
    if cwd is not None:
        project_root = resolve_project_root(cwd)
        if project_root is not None:
            project_config_path = project_root / ".claude" / config_filename
            if project_config_path.exists():
                enabled = read_opt_out_enabled(project_config_path)
                if enabled is not None:
                    return enabled

    config_path = CLAUDE_DIR / config_filename
    if config_path.exists():
        enabled = read_opt_out_enabled(config_path)
        if enabled is not None:
            return enabled
    return True


def filter_opt_out_entries(
    ranked: list[tuple[int, dict[str, Any]]],
    cwd: Path | None,
) -> tuple[list[tuple[int, dict[str, Any]]], list[str]]:
    filtered: list[tuple[int, dict[str, Any]]] = []
    skipped_paths: list[str] = []
    for item in ranked:
        entry = item[1]
        rel_path = entry.get("path")
        if not isinstance(rel_path, str):
            filtered.append(item)
            continue
        config_filename = OPT_OUT_RULES.get(rel_path)
        if config_filename is None or is_opt_out_rule_enabled(config_filename, cwd):
            filtered.append(item)
            continue
        skipped_paths.append(rel_path)
    return filtered, skipped_paths


def select_contents(ranked: list[tuple[int, dict[str, Any]]]) -> tuple[list[str], list[str]]:
    selected: list[str] = []
    selected_paths: list[str] = []
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
        selected_paths.append(rel_path)
        total_size += content_size
    return selected, selected_paths


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
        raw_cwd = payload.get("cwd")
        cwd = Path(raw_cwd) if isinstance(raw_cwd, str) and raw_cwd.strip() else Path(os.getcwd())

        ranked = match_entries(prompt, load_index())
        ranked, skipped_paths = filter_opt_out_entries(ranked, cwd)
        if skipped_paths:
            meta["opt_out_skipped"] = skipped_paths
        selected, selected_paths = select_contents(ranked)
        if not selected:
            return 0

        header = f"## On-Demand Rules Injected ({len(selected)} rules matched)"
        meta["rules_injected"] = len(selected)
        meta["injected_rules"] = selected_paths
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
