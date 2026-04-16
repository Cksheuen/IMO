#!/usr/bin/env python3
"""Lightweight project architecture preflight injector for UserPromptSubmit.

Goal:
- When a session starts working in a new/unfamiliar project, inject a short,
  architecture-first reminder based on actual project files.
- Keep output small, deterministic, and cheap.
- Do not replace the agent reading files; only point it to the right entrypoints.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import importlib.util
from pathlib import Path
from typing import Any

CACHE_PATH = Path.home() / ".claude" / "cache" / "project-architecture-session-cache.json"
MAX_CONTEXT_CHARS = 520
METRICS_EMIT_PATH = Path.home() / ".claude" / "hooks" / "metrics" / "emit.py"

IMPLEMENT_INTENT_PATTERNS = (
    r"\bimplement\b",
    r"\bfix\b",
    r"\brefactor\b",
    r"\breview\b",
    r"\btest\b",
    r"\bwrite\s+test",
    r"\bmodify\b",
    r"\bedit\b",
    r"\bpatch\b",
    r"\badd\b",
    r"\bupdate\b",
    r"实现",
    r"修复",
    r"重构",
    r"测试",
    r"评审",
    r"review",
    r"修改",
    r"新增",
    r"补测试",
    r"写测试",
)

ARCHITECTURE_PATTERNS = (
    r"架构",
    r"architecture",
    r"模块化",
    r"分层",
    r"结构",
    r"目录",
    r"拆分",
    r"解耦",
)


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


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
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def load_cache() -> dict[str, str]:
    try:
      payload = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
      return {}
    if not isinstance(payload, dict):
      return {}
    out: dict[str, str] = {}
    for key, value in payload.items():
      if isinstance(key, str) and isinstance(value, str):
        out[key] = value
    return out


def save_cache(cache: dict[str, str]) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(
            json.dumps(cache, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
            encoding="utf-8",
        )
    except OSError:
        return


def should_trigger(prompt: str) -> bool:
    lowered = prompt.strip().lower()
    if not lowered:
        return False
    for pattern in IMPLEMENT_INTENT_PATTERNS + ARCHITECTURE_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            return True
    return False


def explicit_architecture_request(prompt: str) -> bool:
    return any(re.search(pattern, prompt, flags=re.IGNORECASE) for pattern in ARCHITECTURE_PATTERNS)


def resolve_project_root(cwd: Path) -> Path:
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
            return Path(root)
    except Exception:
        pass

    markers = ("AGENTS.md", "CLAUDE.md", "package.json", "pyproject.toml", "Cargo.toml", ".git")
    current = cwd.resolve()
    for candidate in (current, *current.parents):
        if any((candidate / marker).exists() for marker in markers):
            return candidate
    return cwd.resolve()


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def detect_stack(root: Path) -> list[str]:
    stack: list[str] = []

    package_json = root / "package.json"
    if package_json.exists():
        payload = read_json(package_json)
        deps: dict[str, Any] = {}
        for key in ("dependencies", "devDependencies"):
            value = payload.get(key)
            if isinstance(value, dict):
                deps.update(value)
        stack.append("Node")
        if "typescript" in deps:
            stack.append("TypeScript")
        if "react" in deps:
            stack.append("React")
        if "vite" in deps or "@vitejs/plugin-react" in deps:
            stack.append("Vite")
        if "@tauri-apps/api" in deps:
            stack.append("Tauri")
        if "next" in deps:
            stack.append("Next.js")

    if (root / "Cargo.toml").exists():
        stack.append("Rust")
    if (root / "pyproject.toml").exists() or (root / "requirements.txt").exists():
        stack.append("Python")
    if (root / "go.mod").exists():
        stack.append("Go")

    deduped: list[str] = []
    seen: set[str] = set()
    for item in stack:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped[:6]


def collect_entry_files(root: Path) -> list[str]:
    candidates = [
        "AGENTS.md",
        "CLAUDE.md",
        "README.md",
        ".claude/tasks/current/context.md",
        ".claude/tasks/current/prd.md",
        "docs/architecture.md",
        "docs/architecture-overview.md",
        "docs/design.md",
        "package.json",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
    ]
    found: list[str] = []
    for rel in candidates:
        if (root / rel).exists():
            found.append(rel)
    return found[:6]


def collect_layout(root: Path) -> list[str]:
    dirs = [
        "src",
        "src/pages",
        "src/components",
        "src/hooks",
        "src/lib",
        "src/services",
        "src/adapters",
        "src-tauri",
        "app",
        "components",
        "hooks",
        "lib",
        "packages",
        "services",
        "tests",
        "test",
    ]
    return [path for path in dirs if (root / path).exists()][:7]


def build_context(root: Path) -> str:
    entry_files = collect_entry_files(root)
    stack = detect_stack(root)
    layout = collect_layout(root)

    lines = [
        "Architecture preflight (high priority):",
        f"- Project root: {root}",
    ]
    if entry_files:
        lines.append("- Read first: " + ", ".join(entry_files))
    if stack:
        lines.append("- Detected stack: " + " + ".join(stack))
    if layout:
        lines.append("- Detected layout: " + ", ".join(layout))
    lines.append("- Constraint: first understand the existing architecture, then extend it. Do not impose a new directory/layering style before reading these entrypoints.")
    lines.append("- Modularity rule: extract reusable/testable logic out of large files, but place it into the project's existing layers instead of inventing a parallel architecture.")

    context = "\n".join(lines)
    if len(context) <= MAX_CONTEXT_CHARS:
        return context
    return context[: MAX_CONTEXT_CHARS - 1].rstrip() + "…"


def main() -> None:
    emit_event = load_metrics_emit()
    start = time.monotonic()
    session_id = ""
    response: dict[str, Any] = {}
    status = "ok"
    meta: dict[str, Any] = {"context_chars": 0}

    try:
        payload = parse_payload()
        prompt = str(payload.get("prompt", "")).strip()
        session_id = str(payload.get("session_id") or payload.get("sessionId") or "").strip()
        triggered = should_trigger(prompt)
        meta["triggered"] = triggered
        if not triggered:
            return

        cwd = Path(os.getcwd())
        root = resolve_project_root(cwd)
        cache = load_cache()
        root_key = str(root)

        if session_id and cache.get(session_id) == root_key and not explicit_architecture_request(prompt):
            meta["cache_hit"] = True
            return

        context = build_context(root)
        if not context:
            meta["context_chars"] = 0
            return

        if session_id:
            cache[session_id] = root_key
            save_cache(cache)

        meta["context_chars"] = len(context)
        response = {"hookSpecificOutput": {"additionalContext": context}}
    except Exception:
        status = "error"
        response = {}
    finally:
        if callable(emit_event):
            emit_event(
                hook_id="project-architecture-inject",
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
