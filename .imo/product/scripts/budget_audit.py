#!/usr/bin/env python3
"""Read-only audit of repository-visible context surfaces."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any


SOURCE_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_VERSION = 1
INSTRUCTION_NAMES = ("AGENTS.md", "CLAUDE.md", "CODEX.md")
IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".turbo",
    ".yarn",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "output",
}
ROOT_INSTRUCTION_THRESHOLD = 15_000
SKILL_ENTRYPOINT_THRESHOLD = 10_000


def _token_range(chars: int) -> dict[str, int]:
    return {"chars_per_3": (chars + 2) // 3, "chars_per_4": (chars + 3) // 4}


def _resolve_target(raw: str | None) -> Path:
    target = Path(raw).expanduser().resolve() if raw else SOURCE_ROOT
    if not target.is_dir():
        raise SystemExit(f"target repo not found: {target}")
    return target


def _rel(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in IGNORED_DIRS and not name.startswith(".backup-")]
        current = Path(dirpath)
        files.extend(current / name for name in filenames)
    return sorted(files)


def _entries(root: Path, paths: list[Path]) -> list[dict[str, Any]]:
    return [
        {"path": _rel(root, path), "chars": _size(path), "symlink": path.is_symlink()}
        for path in sorted(paths)
    ]


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        try:
            return path.lstat().st_size
        except OSError:
            return 0


def _slice(
    slice_id: str,
    label: str,
    *,
    owner: str,
    controllability: str,
    chars: int | None = None,
    entries: list[dict[str, Any]] | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": slice_id,
        "label": label,
        "owner": owner,
        "controllability": controllability,
        "measurable": chars is not None,
    }
    if chars is not None:
        result["chars"] = chars
        result["approx_tokens"] = _token_range(chars)
    if entries is not None:
        result["entries"] = entries
    if note:
        result["note"] = note
    return result


def _instruction_files(root: Path) -> tuple[list[Path], list[Path]]:
    root_files = [root / name for name in INSTRUCTION_NAMES if (root / name).is_file()]
    nested = [
        path
        for path in _iter_files(root)
        if path.name in INSTRUCTION_NAMES and path.parent != root
    ]
    return root_files, nested


def _skill_entries(root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    candidates = (root / ".imo/product/skills", root / "skills", root / ".agents/skills")
    skills_root = next((path for path in candidates if path.is_dir()), None)
    if skills_root is None:
        return entries
    for child in sorted(skills_root.iterdir()):
        if child.name.startswith(".") or not child.is_dir():
            continue
        inventory_chars = sum(_size(path) for path in _iter_files(child))
        entrypoint = child / "SKILL.md"
        entrypoint_chars = _size(entrypoint) if entrypoint.is_file() else 0
        entries.append(
            {
                "path": _rel(root, child),
                "chars": entrypoint_chars,
                "inventory_chars": inventory_chars,
                "symlink": child.is_symlink(),
            }
        )
    return entries


def _imo_context(root: Path) -> dict[str, Any] | None:
    script = root / ".imo/product/scripts/codex_context.py"
    if not script.is_file():
        return None
    env = os.environ.copy()
    env.update(
        IMO_DISABLE_EVENTS="1",
        IMO_DISABLE_LEARNING_EVENTS="1",
        IMO_DISABLE_OBSERVABILITY_EVENTS="1",
    )
    result = subprocess.run(
        [sys.executable, str(script), "--empty", "--stats"],
        cwd=root,
        env=env,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        return {"path": _rel(root, script), "error": result.stderr.strip() or f"exit {result.returncode}"}
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        return {"path": _rel(root, script), "error": f"invalid json: {exc}"}
    payload["path"] = _rel(root, script)
    return payload


def build_report(root: Path) -> dict[str, Any]:
    slices = [
        _slice(
            "platform_system_prompt",
            "Platform system/developer prompt",
            owner="platform",
            controllability="not_controllable",
            note="Platform instructions and tool definitions are not observable from the repository.",
        )
    ]
    recommendations: list[dict[str, str]] = []

    root_instructions, nested_instructions = _instruction_files(root)
    if root_instructions:
        entries = _entries(root, root_instructions)
        chars = sum(item["chars"] for item in entries)
        slices.append(_slice("root_instruction_files", "Root instruction files", owner="target_project", controllability="controllable", chars=chars, entries=entries))
        if chars > ROOT_INSTRUCTION_THRESHOLD:
            recommendations.append({"id": "root-instruction-indexing", "summary": "Keep root instructions as a compact router and move details behind on-demand references."})
    if nested_instructions:
        entries = _entries(root, nested_instructions)
        slices.append(_slice("nested_instruction_files", "Nested instruction files", owner="target_project", controllability="controllable_on_demand", chars=sum(item["chars"] for item in entries), entries=entries, note="Nested instructions are normally loaded only for the relevant subtree."))

    skills = _skill_entries(root)
    if skills:
        slices.append(_slice("skill_entrypoints", "Skill entrypoints", owner="target_project", controllability="controllable_on_demand", chars=sum(item["chars"] for item in skills), entries=skills, note="Only a matching SKILL.md entrypoint is loaded; references and implementation assets remain cold until requested."))
        if any(item["chars"] > SKILL_ENTRYPOINT_THRESHOLD for item in skills):
            recommendations.append({"id": "skill-lazy-loading", "summary": "At least one SKILL.md exceeds 10 KB; move examples, templates, and volatile provider detail behind references."})

    context = _imo_context(root)
    if context:
        chars = context.get("total_chars")
        if isinstance(chars, int):
            slices.append(_slice("imo_context_block", "IMO context block", owner="imo", controllability="controllable", chars=chars, entries=[{"path": context["path"], "mode": context.get("mode"), "chars": chars}]))
        elif context.get("error"):
            recommendations.append({"id": "context-measurement", "summary": f"IMO context could not be measured: {context['error']}"})

    if not recommendations:
        recommendations.append({"id": "keep-lazy-loading", "summary": "Current visible context is within the local thresholds; keep detailed knowledge on demand and re-audit after adding rules or skills."})

    directly_controllable = [
        item
        for item in slices
        if isinstance(item.get("chars"), int) and item.get("controllability") == "controllable"
    ]
    on_demand_inventory_chars = sum(
        item.get("inventory_chars", 0)
        for item in skills
        if isinstance(item.get("inventory_chars"), int)
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "root": str(root),
        "slices": slices,
        "directly_controllable_context_chars": sum(item["chars"] for item in directly_controllable),
        "skill_entrypoint_chars": sum(item["chars"] for item in skills),
        "on_demand_inventory_chars": on_demand_inventory_chars,
        "recommendations": recommendations,
    }


def _print_human(report: dict[str, Any]) -> None:
    print("IMO Context Budget Audit")
    print(f"Root: {report['root']}")
    for item in report["slices"]:
        chars = item.get("chars")
        amount = f"{chars} chars" if isinstance(chars, int) else "not measurable"
        print(f"- {item['label']}: {amount} [{item['owner']}; {item['controllability']}]")
    print("Recommendations:")
    for item in report["recommendations"]:
        print(f"- {item['summary']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", nargs="?")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = build_report(_resolve_target(args.target))
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        _print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
