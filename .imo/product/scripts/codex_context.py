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

try:
    import learning as learning_plane
except Exception:  # pragma: no cover - profile context must degrade cleanly
    learning_plane = None

import root_resolver

SOURCE_ROOT = Path(__file__).resolve().parents[3]
RULES_PATH = SOURCE_ROOT / ".imo/product/rules/rules.json"
CONTEXT_MODE_BUDGETS = {
    "compact": 1200,
    "standard": 2200,
    "full": 4000,
}
SECTION_BUDGETS = {
    "compact": {
        "rules": (1, 180),
        "project_profile": (3, 360),
        "user_profile": (2, 360),
        "digest": (1, 220, 140),
    },
    "standard": {
        "rules": (1, 240),
        "project_profile": (5, 620),
        "user_profile": (4, 520),
        "digest": (3, 460, 160),
    },
    "full": {
        "rules": (4, 520),
        "project_profile": (8, 1400),
        "user_profile": (8, 1400),
        "digest": (8, 1100, 220),
    },
}
DEFAULT_CONTEXT_MODE = "standard"
PRIORITY_LINE = (
    "Priority: current user instruction > repo/task rules > current local evidence > "
    "project profile > user profile > active digest."
)


def _arg_value(args: list[str], option: str) -> str | None:
    if option not in args:
        return None
    index = args.index(option)
    if index + 1 >= len(args):
        return None
    return args[index + 1]


def _valid_modes() -> str:
    return "|".join(CONTEXT_MODE_BUDGETS)


def _validate_args(args: list[str]) -> str | None:
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in {"--empty", "--stats"}:
            index += 1
            continue
        if arg == "--mode":
            if index + 1 >= len(args) or args[index + 1].startswith("--"):
                return "--mode requires a value"
            if args[index + 1] not in CONTEXT_MODE_BUDGETS:
                return f"--mode must be one of: {_valid_modes()}"
            index += 2
            continue
        return f"unsupported argument: {arg}"

    if "--mode" not in args:
        env_mode = os.environ.get("IMO_CONTEXT_MODE")
        if env_mode and env_mode not in CONTEXT_MODE_BUDGETS:
            return f"IMO_CONTEXT_MODE must be one of: {_valid_modes()}"
    return None


def _context_mode(args: list[str]) -> str:
    return _arg_value(args, "--mode") or os.environ.get("IMO_CONTEXT_MODE") or DEFAULT_CONTEXT_MODE


def _read_hook_input() -> dict:
    if "--empty" in sys.argv[1:]:
        return {}
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _compact_text(value: str, limit: int) -> str:
    compact = " ".join(value.strip().split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _bounded_lines(lines: list[str], *, max_lines: int, max_chars: int) -> list[str]:
    bounded: list[str] = []
    total = 0
    for line in lines:
        compact = " ".join(line.strip().split())
        if not compact:
            continue
        if len(compact) > max_chars:
            compact = _compact_text(compact, max_chars)
        next_total = total + len(compact)
        if bounded and next_total > max_chars:
            break
        bounded.append(compact)
        total = next_total
        if len(bounded) >= max_lines:
            break
    return bounded


def _active_rule_context(max_lines: int, max_chars: int) -> list[str]:
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
    return _bounded_lines(lines, max_lines=max_lines, max_chars=max_chars)


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


def _active_digest_context(
    project_root: Path | None,
    *,
    max_items: int,
    max_chars: int,
    max_summary_length: int,
) -> list[str]:
    lines: list[str] = []
    roots: list[tuple[str, Path]] = []
    if project_root is not None:
        roots.append(("project", project_root / ".imo/.runtime/learning/digest.json"))
    roots.append(("global", root_resolver.global_runtime_root() / "learning/digest.json"))

    seen: set[str] = set()
    for source, path in roots:
        items = sorted(
            _load_digest_items(path),
            key=lambda item: 0 if item.get("priority") == "high" else 1,
        )
        for item in items:
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
            if len(compact_summary) > max_summary_length:
                compact_summary = compact_summary[: max_summary_length - 3].rstrip() + "..."
            priority = item.get("priority")
            scope = item.get("scope")
            prefix = f"[{source}:{scope}"
            if priority == "high":
                prefix += ", high"
            prefix += "]"
            lines.append(f"- {prefix} {compact_summary}")
            if len(lines) >= max_items:
                return _bounded_lines(lines, max_lines=max_items, max_chars=max_chars)
    return _bounded_lines(lines, max_lines=max_items, max_chars=max_chars)


def _project_profile_context(max_lines: int, max_chars: int) -> list[str]:
    if project_profile is None:
        return []
    try:
        return project_profile.context_lines(max_lines=max_lines, max_chars=max_chars)
    except Exception:
        return ["- status: invalid (project profile context could not be read)."]


def _user_profile_context(max_lines: int, max_chars: int) -> list[str]:
    if learning_plane is None:
        return []
    try:
        return learning_plane.user_profile_context_lines(max_lines=max_lines, max_chars=max_chars)
    except Exception:
        return []


def _build_sections(data: dict, mode: str) -> list[tuple[str, list[str]]]:
    cwd = data.get("cwd")
    project_root = root_resolver.resolve_project_root(cwd) if isinstance(cwd, str) and cwd else root_resolver.resolve_project_root()
    cwd_line = f"Cwd: {cwd}" if isinstance(cwd, str) and cwd else f"Cwd: {SOURCE_ROOT}"
    project_line = f"Project root: {project_root}" if project_root is not None else "Project root: not detected"
    budgets = SECTION_BUDGETS[mode]
    base_lines = [
        "<imo-context>",
        f"Mode: IMO context ({mode})",
        "Entrypoint: `imo` or project `./imo`",
        cwd_line,
        project_line,
        "Boundary: Trellis remains the task plane; IMO owns capability and learning context only.",
        PRIORITY_LINE,
    ]
    if mode != "compact":
        base_lines.insert(2, "Commands: `imo global status`, `imo learning list --scope merged`, `imo task graph`, `imo verify`.")
    sections: list[tuple[str, list[str]]] = [("base", base_lines)]

    rule_lines, rule_chars = budgets["rules"]
    rule_context = _active_rule_context(rule_lines, rule_chars)
    if rule_context:
        sections.append(("rules", ["Active IMO rules:"] + rule_context))

    profile_lines, profile_chars = budgets["project_profile"]
    profile_context = _project_profile_context(profile_lines, profile_chars)
    if profile_context:
        sections.append(("project_profile", ["Project profile:"] + profile_context))

    user_lines, user_chars = budgets["user_profile"]
    user_profile_context = _user_profile_context(user_lines, user_chars)
    if user_profile_context:
        sections.append(("user_profile", ["User profile:"] + user_profile_context))

    digest_items, digest_chars, digest_summary = budgets["digest"]
    digest_context = _active_digest_context(
        project_root,
        max_items=digest_items,
        max_chars=digest_chars,
        max_summary_length=digest_summary,
    )
    if digest_context:
        sections.append(
            (
                "digest",
                ["Active IMO learning digest:", "- project items precede global items; candidates/raw signals are not injected."]
                + digest_context,
            )
        )

    sections.append(("note", ["Note: informational only; user instructions, parent-agent instructions, and Trellis workflow win.", "</imo-context>"]))
    return sections


def _render_sections(sections: list[tuple[str, list[str]]], mode: str) -> tuple[str, dict[str, dict[str, int]]]:
    max_chars = CONTEXT_MODE_BUDGETS[mode]
    rendered: list[str] = []
    section_stats: dict[str, dict[str, int]] = {}
    used = 0
    closing = "</imo-context>"
    closing_len = len(closing) + 1
    for label, lines in sections:
        kept: list[str] = []
        for line in lines:
            if line == closing:
                continue
            line_len = len(line) + 1
            if used + line_len + closing_len > max_chars:
                continue
            rendered.append(line)
            kept.append(line)
            used += line_len
        if kept:
            section_stats[label] = {
                "chars": len("\n".join(kept)),
                "lines": len(kept),
            }
    if not rendered or rendered[-1] != closing:
        rendered.append(closing)
    context = "\n".join(rendered)
    return context, section_stats


def _build_context_with_stats(data: dict, mode: str) -> tuple[str, dict[str, object]]:
    sections = _build_sections(data, mode)
    context, section_stats = _render_sections(sections, mode)
    total_chars = len(context)
    stats: dict[str, object] = {
        "mode": mode,
        "budget_chars": CONTEXT_MODE_BUDGETS[mode],
        "total_chars": total_chars,
        "total_lines": context.count("\n") + 1,
        "approx_tokens": {
            "chars_per_3": (total_chars + 2) // 3,
            "chars_per_4": (total_chars + 3) // 4,
        },
        "sections": section_stats,
    }
    return context, stats


def _build_context(data: dict, mode: str = DEFAULT_CONTEXT_MODE) -> str:
    context, _ = _build_context_with_stats(data, mode)
    return context


def _digest_injected_count(data: dict, mode: str) -> int:
    budgets = SECTION_BUDGETS[mode]
    digest_items, digest_chars, digest_summary = budgets["digest"]
    cwd = data.get("cwd")
    project_root = root_resolver.resolve_project_root(cwd) if isinstance(cwd, str) and cwd else root_resolver.resolve_project_root()
    return len(
        _active_digest_context(
            project_root,
            max_items=digest_items,
            max_chars=digest_chars,
            max_summary_length=digest_summary,
        )
    )


def main() -> int:
    if os.environ.get("IMO_HOOKS") == "0" or os.environ.get("IMO_DISABLE_HOOKS") == "1":
        return 0

    args = sys.argv[1:]
    validation_error = _validate_args(args)
    if validation_error is not None:
        print(f"imo codex context: {validation_error}", file=sys.stderr)
        return 64

    data = _read_hook_input()
    mode = _context_mode(args)
    context, stats = _build_context_with_stats(data, mode)
    if "--stats" in args:
        print(json.dumps(stats, sort_keys=True))
        return 0

    if learning_events is not None:
        try:
            injected_count = _digest_injected_count(data, mode)
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
