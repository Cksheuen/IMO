#!/usr/bin/env python3
"""Read-only context budget audit for repo-local AI injection surfaces."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


SOURCE_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_VERSION = 1
INSTRUCTION_FILE_NAMES = ("AGENTS.md", "CLAUDE.md", "CODEX.md")
IGNORED_DIR_NAMES = {
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
SKILL_THRESHOLD = 30_000
SPEC_THRESHOLD = 20_000
SESSION_START_THRESHOLD = 10_000


def _token_range(chars: int) -> dict[str, int]:
    return {
        "chars_per_3": (chars + 2) // 3,
        "chars_per_4": (chars + 3) // 4,
    }


def _resolve_target(raw_path: str | None) -> Path:
    if raw_path is None:
        return SOURCE_ROOT
    target = Path(raw_path).expanduser().resolve()
    if not target.is_dir():
        raise SystemExit(f"target repo not found: {target}")
    return target


def _rel(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _is_ignored_dir(path: Path) -> bool:
    return any(part in IGNORED_DIR_NAMES or part.startswith(".backup-") for part in path.parts)


def _iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        rel_current = current.relative_to(root)
        if rel_current != Path(".") and _is_ignored_dir(rel_current):
            dirnames[:] = []
            continue
        dirnames[:] = [
            name
            for name in dirnames
            if name not in IGNORED_DIR_NAMES and not _is_ignored_dir(rel_current / name)
        ]
        for filename in filenames:
            files.append(current / filename)
    return sorted(files)


def _file_size(path: Path) -> int:
    return path.stat().st_size


def _path_entries(root: Path, paths: list[Path]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in sorted(paths):
        entries.append(
            {
                "path": _rel(root, path),
                "chars": _file_size(path),
                "symlink": path.is_symlink(),
            }
        )
    return entries


def _unique_total(paths: list[Path]) -> int:
    total = 0
    seen: set[Path] = set()
    for path in paths:
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        if resolved in seen:
            continue
        seen.add(resolved)
        total += _file_size(path)
    return total


def _instruction_files(root: Path) -> tuple[list[Path], list[Path]]:
    root_level: list[Path] = []
    nested: list[Path] = []
    for name in INSTRUCTION_FILE_NAMES:
        candidate = root / name
        if candidate.is_file():
            root_level.append(candidate)
    for path in _iter_files(root):
        if path.parent == root:
            continue
        if path.name in INSTRUCTION_FILE_NAMES:
            nested.append(path)
    return sorted(root_level), sorted(nested)


def _skill_entries(root: Path) -> list[dict[str, Any]]:
    skills_root = root / ".agents" / "skills"
    if not skills_root.is_dir():
        return []
    entries: list[dict[str, Any]] = []
    for child in sorted(skills_root.iterdir(), key=lambda item: item.name):
        if child.name.startswith("."):
            continue
        if child.is_dir():
            chars = sum(_file_size(path) for path in _iter_files(child))
        elif child.is_file():
            chars = _file_size(child)
        else:
            continue
        entries.append({"path": _rel(root, child), "chars": chars})
    return entries


def _split_skill_entries(entries: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    trellis_entries: list[dict[str, Any]] = []
    project_entries: list[dict[str, Any]] = []
    for entry in entries:
        path = entry.get("path")
        if isinstance(path, str) and path.startswith(".agents/skills/trellis-"):
            trellis_entries.append(entry)
        else:
            project_entries.append(entry)
    return project_entries, trellis_entries


def _trellis_spec_entries(root: Path) -> list[dict[str, Any]]:
    spec_root = root / ".trellis" / "spec"
    if not spec_root.is_dir():
        return []
    return _path_entries(root, _iter_files(spec_root))


def _active_task_entries(root: Path) -> list[dict[str, Any]]:
    tasks_root = root / ".trellis" / "tasks"
    if not tasks_root.is_dir():
        return []
    entries: list[dict[str, Any]] = []
    for child in sorted(tasks_root.iterdir(), key=lambda item: item.name):
        if not child.is_dir() or child.name.startswith(".") or child.name == "archive":
            continue
        chars = sum(_file_size(path) for path in _iter_files(child))
        status = None
        task_json = child / "task.json"
        if task_json.is_file():
            try:
                payload = json.loads(task_json.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = {}
            status = payload.get("status")
        entries.append(
            {
                "path": _rel(root, child),
                "chars": chars,
                "status": status,
            }
        )
    return entries


def _run_json_command(
    *,
    root: Path,
    command: list[str],
    stdin_payload: str | None = None,
    env: dict[str, str] | None = None,
) -> tuple[Any | None, str | None]:
    result = subprocess.run(
        command,
        cwd=root,
        check=False,
        input=stdin_payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        return None, detail
    stdout = result.stdout.strip()
    if not stdout:
        return None, "no output"
    try:
        return json.loads(stdout), None
    except json.JSONDecodeError as exc:
        return None, f"invalid json: {exc}"


def _run_text_command(
    *,
    root: Path,
    command: list[str],
    timeout: int = 8,
) -> tuple[str | None, str | None]:
    try:
        result = subprocess.run(
            command,
            cwd=root,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError) as exc:
        return None, str(exc)
    output = "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)
    if result.returncode != 0:
        return output or None, f"exit {result.returncode}"
    return output, None


def _first_match(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text)
    if not match:
        return None
    return match.group(1).strip()


def _trellis_integration(root: Path) -> dict[str, Any]:
    trellis_dir = root / ".trellis"
    if not trellis_dir.is_dir():
        return {
            "present": False,
            "owner": "external_trellis",
            "note": "No project-local Trellis directory found.",
        }

    info: dict[str, Any] = {
        "present": True,
        "owner": "external_trellis",
        "template_hashes": (trellis_dir / ".template-hashes.json").is_file(),
        "note": "Trellis is an external task plane. IMO audits and adapts to its visible surfaces; it does not claim ownership of Trellis templates or workflow files.",
    }
    output, error = _run_text_command(root=root, command=["trellis", "update", "--dry-run"])
    if error:
        info["status"] = "unknown"
        info["error"] = error
        if output:
            info["output_excerpt"] = output[:500]
        return info

    output = output or ""
    info["project_version"] = _first_match(r"Project version:\s*([^\n]+)", output)
    info["cli_version"] = _first_match(r"CLI version:\s*([^\n]+)", output)
    info["latest_on_npm"] = _first_match(r"Latest on npm:\s*([^\n]+)", output)
    if "✓ Already up to date!" in output:
        info["status"] = "current"
    elif "This will UPGRADE:" in output or "Trellis update available:" in output:
        info["status"] = "update_available"
    elif info.get("project_version") and info.get("project_version") == info.get("cli_version"):
        info["status"] = "current"
    else:
        info["status"] = "unknown"
    return info


def _hook_measurements(root: Path) -> list[dict[str, Any]]:
    env = os.environ.copy()
    env["TRELLIS_DISABLE_HOOKS"] = "0"
    measurements: list[dict[str, Any]] = []
    for rel_path in (
        ".claude/hooks/session-start.py",
        ".codex/hooks/session-start.py",
    ):
        hook_path = root / rel_path
        if not hook_path.is_file():
            continue
        payload, error = _run_json_command(
            root=root,
            command=[sys.executable, str(hook_path)],
            stdin_payload="{}",
            env=env,
        )
        if not isinstance(payload, dict):
            measurements.append({"path": rel_path, "error": error})
            continue
        context = (
            payload.get("hookSpecificOutput", {})
            if isinstance(payload.get("hookSpecificOutput"), dict)
            else {}
        ).get("additionalContext")
        if not isinstance(context, str):
            measurements.append({"path": rel_path, "error": "additionalContext missing"})
            continue
        measurements.append(
            {
                "path": rel_path,
                "chars": len(context),
                "approx_tokens": _token_range(len(context)),
            }
        )
    return measurements


def _imo_context_stats(root: Path) -> dict[str, Any] | None:
    script_path = root / ".imo" / "product" / "scripts" / "codex_context.py"
    if not script_path.is_file():
        return None
    env = os.environ.copy()
    env["IMO_DISABLE_EVENTS"] = "1"
    env["IMO_DISABLE_LEARNING_EVENTS"] = "1"
    env["IMO_DISABLE_OBSERVABILITY_EVENTS"] = "1"
    payload, error = _run_json_command(
        root=root,
        command=[sys.executable, str(script_path), "--empty", "--stats"],
        env=env,
    )
    if not isinstance(payload, dict):
        return {"error": error, "path": _rel(root, script_path)}
    payload["path"] = _rel(root, script_path)
    return payload


def _slice(
    *,
    slice_id: str,
    label: str,
    chars: int | None,
    controllability: str,
    owner: str,
    measurable: bool,
    entries: list[dict[str, Any]] | None = None,
    note: str | None = None,
    threshold_chars: int | None = None,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "id": slice_id,
        "label": label,
        "controllability": controllability,
        "owner": owner,
        "measurable": measurable,
    }
    if chars is not None:
        report["chars"] = chars
        report["approx_tokens"] = _token_range(chars)
    if entries is not None:
        report["entries"] = entries
    if note:
        report["note"] = note
    if threshold_chars is not None:
        report["threshold_chars"] = threshold_chars
        if chars is not None:
            report["over_threshold"] = chars > threshold_chars
    return report


def build_report(root: Path) -> dict[str, Any]:
    trellis_info = _trellis_integration(root)
    slices: list[dict[str, Any]] = [
        _slice(
            slice_id="platform_system_prompt",
            label="Platform system/developer prompt",
            chars=None,
            controllability="not_controllable",
            owner="platform",
            measurable=False,
            note="Hidden platform prompt and tool definitions are not observable from the repo.",
        )
    ]
    recommendations: list[dict[str, str]] = []
    oversize_items: list[dict[str, Any]] = []

    root_instruction_files, nested_instruction_files = _instruction_files(root)
    if root_instruction_files:
        unique_chars = _unique_total(root_instruction_files)
        slices.append(
            _slice(
                slice_id="root_instruction_files",
                label="Root instruction files",
                chars=unique_chars,
                controllability="controllable",
                owner="target_project",
                measurable=True,
                entries=_path_entries(root, root_instruction_files),
                threshold_chars=ROOT_INSTRUCTION_THRESHOLD,
            )
        )
        if unique_chars > ROOT_INSTRUCTION_THRESHOLD:
            recommendations.append(
                {
                    "id": "root-instruction-indexing",
                    "summary": "Root instruction files exceed the always-loaded budget; move detailed prose behind indexes or per-package docs.",
                }
            )
    if nested_instruction_files:
        nested_chars = _unique_total(nested_instruction_files)
        slices.append(
            _slice(
                slice_id="nested_instruction_files",
                label="Nested instruction files",
                chars=nested_chars,
                controllability="controllable",
                owner="target_project",
                measurable=True,
                entries=_path_entries(root, nested_instruction_files),
                note="Nested AGENTS/CLAUDE/CODEX files are usually loaded on demand from the current package.",
            )
        )

    skill_entries = _skill_entries(root)
    if skill_entries:
        project_skill_entries, trellis_skill_entries = _split_skill_entries(skill_entries)
        if project_skill_entries:
            skill_total = sum(entry["chars"] for entry in project_skill_entries)
            slices.append(
                _slice(
                    slice_id="skill_payloads",
                    label="Project skill payloads",
                    chars=skill_total,
                    controllability="controllable_on_demand",
                    owner="target_project",
                    measurable=True,
                    entries=project_skill_entries,
                    note="Project skills are usually on-demand. IMO should flag oversized payloads and, when adopting them, keep references indexed and lazy-loaded.",
                )
            )
        if trellis_skill_entries:
            trellis_skill_total = sum(entry["chars"] for entry in trellis_skill_entries)
            slices.append(
                _slice(
                    slice_id="trellis_skill_payloads",
                    label="Trellis skill payloads",
                    chars=trellis_skill_total,
                    controllability="external_on_demand",
                    owner="external_trellis",
                    measurable=True,
                    entries=trellis_skill_entries,
                    note="Bundled Trellis skills are external and on-demand. IMO should measure their cost and avoid duplicating them into IMO-owned context.",
                )
            )
        oversized_project_skills = [
            entry for entry in project_skill_entries if entry["chars"] > SKILL_THRESHOLD
        ]
        oversized_trellis_skills = [
            entry for entry in trellis_skill_entries if entry["chars"] > SKILL_THRESHOLD
        ]
        for entry in oversized_project_skills:
            oversize_items.append(
                {
                    "path": entry["path"],
                    "chars": entry["chars"],
                    "kind": "skill",
                    "owner": "target_project",
                    "threshold_chars": SKILL_THRESHOLD,
                }
            )
        for entry in oversized_trellis_skills:
            oversize_items.append(
                {
                    "path": entry["path"],
                    "chars": entry["chars"],
                    "kind": "skill",
                    "owner": "external_trellis",
                    "threshold_chars": SKILL_THRESHOLD,
                }
            )
        if oversized_project_skills:
            recommendations.append(
                {
                    "id": "skill-lazy-loading",
                    "summary": "Project skill payloads exceed 30 KB. IMO should keep adopted knowledge indexed and lazy-loaded instead of injecting monolithic reference trees.",
                }
            )
        if oversized_trellis_skills:
            recommendations.append(
                {
                    "id": "avoid-trellis-skill-duplication",
                    "summary": "Trellis skill payloads exceed 30 KB. Treat them as external on-demand tools; optimize IMO by referencing or measuring them, not by copying their content into IMO context.",
                }
            )

    workflow_path = root / ".trellis" / "workflow.md"
    if workflow_path.is_file():
        workflow_chars = _file_size(workflow_path)
        slices.append(
            _slice(
                slice_id="trellis_workflow_source",
                label="Trellis workflow source",
                chars=workflow_chars,
                controllability="external_reference",
                owner="external_trellis",
                measurable=True,
                entries=_path_entries(root, [workflow_path]),
                note="Trellis owns this workflow template. IMO uses it as integration evidence and should not treat it as an IMO-owned optimization target.",
            )
        )

    spec_entries = _trellis_spec_entries(root)
    if spec_entries:
        spec_total = sum(entry["chars"] for entry in spec_entries)
        slices.append(
            _slice(
                slice_id="trellis_spec_files",
                label="Trellis spec files",
                chars=spec_total,
                controllability="target_project_data",
                owner="target_project",
                measurable=True,
                entries=spec_entries,
                note="Specs are target-project data in Trellis format. IMO may use their size to keep its own task references precise; it should not rewrite external project specs unless explicitly asked.",
            )
        )
        oversized_specs = [entry for entry in spec_entries if entry["chars"] > SPEC_THRESHOLD]
        for entry in oversized_specs:
            oversize_items.append(
                {
                    "path": entry["path"],
                    "chars": entry["chars"],
                    "kind": "spec_file",
                    "owner": "target_project",
                    "threshold_chars": SPEC_THRESHOLD,
                }
            )
        if oversized_specs:
            recommendations.append(
                {
                    "id": "split-large-spec-files",
                    "summary": "At least one target-project spec file exceeds 20 KB. IMO should reference precise spec leaves; split specs only when the target project explicitly owns that cleanup.",
                }
            )

    hook_entries = _hook_measurements(root)
    valid_hook_entries = [entry for entry in hook_entries if isinstance(entry.get("chars"), int)]
    if valid_hook_entries:
        max_hook_chars = max(entry["chars"] for entry in valid_hook_entries)
        slices.append(
            _slice(
                slice_id="trellis_session_start_injection",
                label="Trellis hook injected output",
                chars=max_hook_chars,
                controllability="external_integration",
                owner="external_trellis",
                measurable=True,
                entries=valid_hook_entries,
                threshold_chars=SESSION_START_THRESHOLD,
                note="Measured from actual Trellis hook output. IMO uses this to decide whether to adapt, upgrade, or reduce duplicate IMO context.",
            )
        )
        if max_hook_chars > SESSION_START_THRESHOLD:
            if trellis_info.get("status") == "update_available":
                summary = (
                    "Trellis session-start output exceeds 10 KB and the target Trellis install is not current. "
                    "IMO should recommend upgrading Trellis first, then re-measure before tuning IMO context."
                )
            else:
                summary = (
                    "Trellis session-start output exceeds 10 KB. IMO should avoid duplicate injected guidance and route simple tasks through its lightest advisory path; Trellis itself remains external."
                )
            recommendations.append(
                {
                    "id": "trellis-integration-budget",
                    "summary": summary,
                }
            )
    elif hook_entries:
        slices.append(
            _slice(
                slice_id="trellis_session_start_injection",
                label="Trellis hook injected output",
                chars=None,
                controllability="external_integration",
                owner="external_trellis",
                measurable=False,
                entries=hook_entries,
                note="Hook scripts were present but their output could not be measured cleanly.",
            )
        )

    imo_stats = _imo_context_stats(root)
    if imo_stats is not None:
        if isinstance(imo_stats.get("total_chars"), int):
            slices.append(
                _slice(
                    slice_id="imo_context_block",
                    label="IMO codex context block",
                    chars=imo_stats["total_chars"],
                    controllability="bounded",
                    owner="imo",
                    measurable=True,
                    entries=[
                        {
                            "path": imo_stats.get("path"),
                            "mode": imo_stats.get("mode"),
                            "budget_chars": imo_stats.get("budget_chars"),
                        }
                    ],
                    note="Reuses the existing read-only codex context stats output.",
                )
            )
        else:
            slices.append(
                _slice(
                    slice_id="imo_context_block",
                    label="IMO codex context block",
                    chars=None,
                    controllability="bounded",
                    owner="imo",
                    measurable=False,
                    entries=[imo_stats],
                    note="IMO context stats were present but could not be measured cleanly.",
                )
            )

    active_task_entries = _active_task_entries(root)
    if active_task_entries:
        task_total = sum(entry["chars"] for entry in active_task_entries)
        slices.append(
            _slice(
                slice_id="active_task_files",
                label="Active task files",
                chars=task_total,
                controllability="target_project_data",
                owner="target_project",
                measurable=True,
                entries=active_task_entries,
                note="Non-archived task directories under .trellis/tasks/.",
            )
        )

    if not recommendations:
        recommendations.append(
            {
                "id": "no-large-local-slices-found",
                "summary": "No measured local slice crossed the configured thresholds. The remaining budget risk is likely hidden platform context or conversation/tool history.",
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "root": str(root),
        "trellis_integration": trellis_info,
        "thresholds": {
            "root_instruction_chars": ROOT_INSTRUCTION_THRESHOLD,
            "skill_chars": SKILL_THRESHOLD,
            "spec_file_chars": SPEC_THRESHOLD,
            "session_start_chars": SESSION_START_THRESHOLD,
        },
        "slices": slices,
        "oversized_items": oversize_items,
        "recommendations": recommendations,
    }


def _render_human(report: dict[str, Any]) -> str:
    lines = [
        "Context Budget Audit",
        f"Root: {report['root']}",
        "",
    ]
    trellis_info = report.get("trellis_integration")
    if isinstance(trellis_info, dict) and trellis_info.get("present"):
        status = trellis_info.get("status", "unknown")
        project_version = trellis_info.get("project_version") or "unknown"
        cli_version = trellis_info.get("cli_version") or "unknown"
        lines.extend(
            [
                f"Trellis integration: {status} (project={project_version}, cli={cli_version})",
                "Trellis owner: external; IMO measures/adapts and does not claim Trellis templates.",
                "",
            ]
        )
    lines.append("Measured slices:")
    for slice_report in report["slices"]:
        owner = slice_report.get("owner", "unknown")
        prefix = f"- {slice_report['label']} [{slice_report['controllability']}, owner={owner}]"
        if isinstance(slice_report.get("chars"), int):
            prefix += f": {slice_report['chars']} chars"
            approx = slice_report.get("approx_tokens", {})
            prefix += f" (~{approx.get('chars_per_4', 0)}-{approx.get('chars_per_3', 0)} tokens)"
        else:
            prefix += ": unmeasurable"
        lines.append(prefix)
        if slice_report.get("note"):
            lines.append(f"  note: {slice_report['note']}")
        entries = slice_report.get("entries")
        if isinstance(entries, list):
            for entry in entries[:5]:
                if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                    extra = f" ({entry['chars']} chars)" if isinstance(entry.get("chars"), int) else ""
                    lines.append(f"  - {entry['path']}{extra}")
            if len(entries) > 5:
                lines.append(f"  - ... {len(entries) - 5} more")

    lines.extend(["", "Oversized items:"])
    oversized_items = report.get("oversized_items", [])
    if oversized_items:
        for item in oversized_items:
            owner = item.get("owner", "unknown")
            lines.append(
                f"- {item['path']} [{item['kind']}, owner={owner}] {item['chars']} chars > {item['threshold_chars']}"
            )
    else:
        lines.append("- none")

    lines.extend(["", "Recommendations:"])
    for recommendation in report["recommendations"]:
        lines.append(f"- {recommendation['summary']}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit local AI context surfaces without modifying files.")
    parser.add_argument("target_path", nargs="?", help="Repo root to audit. Defaults to the current IMO source repo.")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON.")
    args = parser.parse_args()

    root = _resolve_target(args.target_path)
    report = build_report(root)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(_render_human(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
