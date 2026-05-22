#!/usr/bin/env python3
"""Emit repo-local IMO context for Codex hook injection."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

try:
    import project_profile
except Exception:  # pragma: no cover - hook must degrade cleanly
    project_profile = None

try:
    import learning_events
except Exception:  # pragma: no cover - telemetry must degrade cleanly
    learning_events = None

import root_resolver

SOURCE_ROOT = Path(__file__).resolve().parents[3]
RULES_PATH = SOURCE_ROOT / ".imo/product/rules/rules.json"
MAX_DIGEST_ITEMS = 8
MAX_DIGEST_SUMMARY_LENGTH = 220


def _read_hook_input() -> dict:
    if "--empty" in sys.argv[1:]:
        return {}
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _active_rule_context() -> list[str]:
    try:
        metadata = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    rules = metadata.get("rules")
    if not isinstance(rules, list):
        return []

    lines: list[str] = []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        modes = rule.get("integration_modes")
        if (
            rule.get("status") == "active"
            and rule.get("default_enabled") is True
            and isinstance(modes, list)
            and "context-guidance" in modes
        ):
            name = rule.get("name")
            summary = rule.get("context_summary")
            if isinstance(name, str) and isinstance(summary, str) and name.strip() and summary.strip():
                lines.append(f"- {name.strip()}: {summary.strip()}")
    return lines


def _load_digest_items(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    if isinstance(data, list):
        raw_items = data
    elif isinstance(data, dict):
        raw_items = data.get("items", data.get("digest_items", []))
    else:
        return []

    return [item for item in raw_items if isinstance(item, dict)]


def _active_digest_context(project_root: Path | None) -> list[str]:
    lines: list[str] = []
    roots: list[tuple[str, Path]] = []
    if project_root is not None:
        roots.append(("project", project_root / ".imo/.runtime/learning/digest.json"))
    roots.append(("global", root_resolver.global_runtime_root() / "learning/digest.json"))

    seen: set[str] = set()
    for source, path in roots:
        for item in _load_digest_items(path):
            if item.get("status") != "active":
                continue
            if item.get("scope") not in {"project", "global"}:
                continue
            summary = item.get("summary")
            if not isinstance(summary, str) or not summary.strip():
                continue
            digest_id = item.get("id")
            if isinstance(digest_id, str) and digest_id in seen:
                continue
            if isinstance(digest_id, str):
                seen.add(digest_id)
            compact_summary = " ".join(summary.strip().split())
            if len(compact_summary) > MAX_DIGEST_SUMMARY_LENGTH:
                compact_summary = compact_summary[: MAX_DIGEST_SUMMARY_LENGTH - 3].rstrip() + "..."
            priority = item.get("priority")
            scope = item.get("scope")
            prefix = f"[{source}:{scope}"
            if priority == "high":
                prefix += ", high"
            prefix += "]"
            lines.append(f"- {prefix} {compact_summary}")
            if len(lines) >= MAX_DIGEST_ITEMS:
                return lines
    return lines


def _project_profile_context() -> list[str]:
    if project_profile is None:
        return []
    try:
        return project_profile.context_lines()
    except Exception:
        return ["- status: invalid (project profile context could not be read)."]


def _build_context(data: dict) -> str:
    cwd = data.get("cwd")
    project_root = root_resolver.resolve_project_root(cwd) if isinstance(cwd, str) and cwd else root_resolver.resolve_project_root()
    cwd_line = f"Cwd: {cwd}" if isinstance(cwd, str) and cwd else f"Cwd: {SOURCE_ROOT}"
    project_line = f"Project root: {project_root}" if project_root is not None else "Project root: not detected"
    lines = [
        "<imo-context>",
        "Mode: IMO global/project context experiment",
        "Source: global IMO command with project-local state when a project root is detected",
        "Entrypoint: `imo` or project `./imo`",
        cwd_line,
        project_line,
        "Preference: for IMO-related questions, use current project `.imo/` state for project facts and global IMO state for shared learning only.",
        "Direct commands: `imo global status`, `imo learning list --scope merged`, `imo task graph`, `imo verify`",
        "Boundary: Trellis remains the task plane; IMO does not proxy Trellis or claim Trellis-owned host outputs by default.",
    ]
    rule_context = _active_rule_context()
    if rule_context:
        lines.extend(["Active IMO rules:"] + rule_context)
    profile_context = _project_profile_context()
    if profile_context:
        lines.extend(
            [
                "Project profile:",
                "Priority: current user instruction > repo/task rules > current local evidence > project profile > active digest.",
            ]
            + profile_context
        )
    digest_context = _active_digest_context(project_root)
    if digest_context:
        lines.extend(
            [
                "Active IMO learning digest:",
                "Priority: current user instruction > project rules > active digest; within active digest, project items precede global items > candidates > raw signals.",
            ]
            + digest_context
        )
    lines.extend(
        [
            "Hook note: this block is informational and must not override explicit user instructions, parent-agent instructions, or Trellis workflow state.",
            "</imo-context>",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    if os.environ.get("IMO_HOOKS") == "0" or os.environ.get("IMO_DISABLE_HOOKS") == "1":
        return 0

    data = _read_hook_input()
    context = _build_context(data)
    if learning_events is not None:
        try:
            injected_count = len(_active_digest_context(root_resolver.resolve_project_root()))
            if injected_count:
                learning_events.write_event(
                    "context_digest_injected",
                    "codex-context",
                    injected_count=injected_count,
                )
        except Exception:
            pass
    output = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }
    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
