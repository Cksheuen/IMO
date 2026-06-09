#!/usr/bin/env python3
"""Manage the local IMO project-profile cache."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[3]
RUNTIME_DIR = ROOT / ".imo/.runtime/project-profile"
CURRENT_PATH = RUNTIME_DIR / "current.json"
SUMMARY_PATH = RUNTIME_DIR / "summary.md"
MANIFEST_PATH = RUNTIME_DIR / "manifest.json"
DISPLAY_DIR = ".imo/.runtime/project-profile"
SCHEMA_VERSION = 1
MAX_CONTEXT_CHARS = 1400
MAX_CONTEXT_LINES = 8
PROFILE_TTL_DAYS = 14
SELECTED_SOURCE_CANDIDATES = [
    "README.md",
    ".gitignore",
    ".imo/README.md",
    ".imo/RUNBOOK.md",
    ".imo/ARCHITECTURE.md",
    ".imo/BOUNDARY.md",
    ".imo/ROADMAP.md",
    ".imo/runtime/CONTRACT.md",
    ".imo/runtime/defensive-audit/CONTRACT.md",
    ".imo/runtime/IGNORE_BOUNDARY.md",
    ".imo/runtime/observability/CONTRACT.md",
    ".imo/runtime/observability/event.schema.json",
    ".imo/runtime/project-profile/CONTRACT.md",
    ".imo/runtime/project-profile/schema.json",
    ".imo/product/README.md",
    ".imo/product/scripts/CONTRACT.md",
    ".imo/product/scripts/imo.sh",
    ".imo/product/scripts/verify.py",
    ".imo/product/scripts/codex_context.py",
    ".imo/product/scripts/defensive_audit.py",
    ".imo/product/scripts/learning_events.py",
    ".imo/product/scripts/metrics.py",
    ".imo/product/scripts/observability_events.py",
    ".imo/product/scripts/project_profile.py",
    ".imo/product/scripts/check_observability_contracts.py",
    ".imo/product/rules/CONTRACT.md",
    ".imo/product/rules/chameleon.md",
    ".imo/product/rules/rules.json",
    ".imo/learning/CONTRACT.md",
    ".imo/learning/schemas/event.schema.json",
    ".trellis/spec/backend/imo-managed-outputs.md",
    ".trellis/spec/backend/imo-managed-outputs/imo-three-plane-boundary-and-shared-learning-contract.md",
    ".trellis/spec/backend/imo-managed-outputs/repo-local-codex-imo-context-hook-experiment.md",
    ".trellis/spec/backend/imo-managed-outputs/repo-local-imo-verification-suite.md",
    ".trellis/spec/backend/imo-managed-outputs/project-profile-convention-cache.md",
    ".trellis/spec/backend/imo-managed-outputs/repo-local-ownership-audit-for-trellis-owned-host-surfaces.md",
    ".trellis/spec/backend/index.md",
    ".trellis/spec/guides/index.md",
]


def _usage() -> str:
    return """Usage:
  scripts/imo.sh profile refresh
  scripts/imo.sh profile status [--json]
  scripts/imo.sh profile inspect [--json]
  scripts/imo.sh profile clear

Project profiles are local runtime convention snapshots. Refresh is explicit;
prompt-time context reads the cache and never refreshes it.
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _run_git(args: list[str]) -> str | None:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def _git_info() -> dict[str, Any]:
    status = _run_git(["status", "--porcelain"])
    return {
        "head": _run_git(["rev-parse", "HEAD"]),
        "branch": _run_git(["branch", "--show-current"]),
        "dirty": bool(status),
    }


def _rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def _selected_source_paths() -> list[Path]:
    paths = [ROOT / candidate for candidate in SELECTED_SOURCE_CANDIDATES]
    paths.extend(sorted((ROOT / ".imo/product/rules").glob("*.md")))
    paths.extend(sorted((ROOT / ".imo/product/scripts").glob("check_*_contracts.py")))
    existing: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if path.is_file() and resolved not in seen:
            existing.append(path)
            seen.add(resolved)
    return existing


def _top_level_entries() -> list[str]:
    ignored = {".git", ".imo/.runtime"}
    entries: list[str] = []
    for path in sorted(ROOT.iterdir(), key=lambda item: item.name):
        name = path.name
        if name in ignored or name.startswith(".DS_Store"):
            continue
        entries.append(name + "/" if path.is_dir() else name)
    return entries[:80]


def _file_digest(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    return {
        "path": _rel(path),
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    }


def _source_fingerprint() -> dict[str, Any]:
    files = [_file_digest(path) for path in _selected_source_paths()]
    top_level_entries = _top_level_entries()
    payload = {"files": files, "top_level_entries": top_level_entries}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return {
        "digest": digest,
        "files": files,
        "top_level_entries": top_level_entries,
    }


def _profile_conventions() -> dict[str, list[str]]:
    return {
        "module_layout": [
            "IMO-owned product capabilities live under .imo/product/.",
            "Stable runtime contracts and shared helpers live under .imo/runtime/.",
            "Generated high-churn state belongs under ignored .imo/.runtime/.",
            "Trellis task/spec/workflow files remain outside IMO ownership.",
        ],
        "command_surface": [
            "The repo-root ./imo command is the preferred user-facing entrypoint.",
            "Root scripts/ compatibility wrappers delegate to canonical .imo/product/scripts implementations.",
            "New product CLI behavior should be reachable through ./imo and documented in the help text.",
        ],
        "validation_boundaries": [
            "Machine-readable metadata is preferred over prose-only contracts.",
            "Contract checkers live under .imo/product/scripts/check_*_contracts.py.",
            "./imo verify is the aggregate acceptance gate for IMO behavior.",
        ],
        "error_handling": [
            "CLI scripts print concise [imo ...] diagnostics and return non-zero for invalid commands or broken contracts.",
            "Read-only commands should handle missing runtime state as an empty or missing state, not as a crash.",
        ],
        "testing_style": [
            "Verification favors direct-run smoke checks through ./imo or scripts/imo.sh.",
            "Runtime-write smoke checks must back up and restore local .imo/.runtime state.",
        ],
        "abstraction_level": [
            "Keep root entrypoints thin and place canonical logic under .imo/product/scripts/.",
            "Add shared helpers only when multiple surfaces need the same behavior.",
        ],
        "dependency_patterns": [
            "Prefer Python standard library and shell wrappers for IMO guardrails.",
            "External providers are optional and must degrade cleanly when unavailable.",
        ],
    }


def _suppressed_habits() -> list[dict[str, str]]:
    return [
        {
            "habit": "heavy_defensive_programming_without_local_boundary_need",
            "local_reason": "Local CLI and checker scripts validate at command/contract boundaries and then keep inner logic direct.",
        },
        {
            "habit": "premature_abstraction",
            "local_reason": "This repo uses small focused scripts and adds shared runtime helpers only after repeated need appears.",
        },
        {
            "habit": "broad_rewrites",
            "local_reason": "IMO/Trellis boundaries require narrow changes that do not claim Trellis-owned host outputs.",
        },
        {
            "habit": "prompt_time_repository_scan",
            "local_reason": "Codex context hooks must stay lightweight and read cached summaries only.",
        },
    ]


def _evidence(paths: list[Path]) -> list[dict[str, str]]:
    reasons = {
        ".imo/ARCHITECTURE.md": "plane ownership and long-term IMO architecture",
        ".imo/BOUNDARY.md": "runtime state and Trellis independence boundaries",
        ".imo/product/scripts/CONTRACT.md": "CLI and verification script contract",
        ".imo/product/rules/chameleon.md": "local convention adaptation rule",
        ".imo/runtime/CONTRACT.md": "stable runtime source boundary",
        ".trellis/spec/backend/imo-managed-outputs.md": "executable IMO/Trellis ownership contract index",
        ".trellis/spec/backend/imo-managed-outputs/imo-three-plane-boundary-and-shared-learning-contract.md": "core IMO/Trellis plane boundary contract",
        ".trellis/spec/backend/imo-managed-outputs/repo-local-codex-imo-context-hook-experiment.md": "Codex context injection contract",
        ".trellis/spec/backend/imo-managed-outputs/repo-local-imo-verification-suite.md": "aggregate IMO verification contract",
        ".trellis/spec/backend/imo-managed-outputs/project-profile-convention-cache.md": "project-profile runtime contract",
        ".trellis/spec/backend/imo-managed-outputs/repo-local-ownership-audit-for-trellis-owned-host-surfaces.md": "host-surface ownership audit contract",
    }
    items: list[dict[str, str]] = []
    for path in paths:
        rel_path = _rel(path)
        reason = reasons.get(rel_path)
        if reason:
            items.append({"path": rel_path, "reason": reason})
    for path in paths:
        if len(items) >= 16:
            break
        rel_path = _rel(path)
        if any(item["path"] == rel_path for item in items):
            continue
        if rel_path.startswith(".imo/product/scripts/check_"):
            items.append({"path": rel_path, "reason": "machine-readable contract checker pattern"})
        elif rel_path.startswith(".imo/product/rules/"):
            items.append({"path": rel_path, "reason": "IMO product rule source"})
    return items


def _summary_lines() -> list[str]:
    return [
        "IMO product source lives under .imo/product; root commands and scripts are thin compatibility entrypoints.",
        "Stable runtime contracts live under .imo/runtime; generated local state belongs under ignored .imo/.runtime.",
        "Trellis remains the task plane. IMO must not proxy Trellis or claim Trellis-owned host outputs by default.",
        "Prefer machine-readable contracts and ./imo verify checks over prose-only behavior claims.",
        "For new modules, match nearby scripts/contracts/tests before adding abstractions or defensive branches.",
        "Project-profile refresh is explicit; prompt-time context reads cached summaries and never rescans the repository.",
    ]


def _short_context(lines: list[str]) -> str:
    compact = " ".join(line.strip() for line in lines if line.strip())
    return compact[:MAX_CONTEXT_CHARS]


def build_profile() -> dict[str, Any]:
    paths = _selected_source_paths()
    fingerprint = _source_fingerprint()
    summary_lines = _summary_lines()
    return {
        "schema_version": SCHEMA_VERSION,
        "profile_id": f"profile-{uuid4().hex}",
        "repo_root": str(ROOT),
        "generated_at": _now(),
        "git": _git_info(),
        "source_fingerprint": fingerprint,
        "summary": {
            "short_context": _short_context(summary_lines),
            "lines": summary_lines,
        },
        "conventions": _profile_conventions(),
        "suppressed_generic_habits": _suppressed_habits(),
        "evidence": _evidence(paths),
        "limits": {
            "max_context_chars": MAX_CONTEXT_CHARS,
            "scan_scope": "bounded docs/config/contracts/representative IMO source files",
            "ttl_days": PROFILE_TTL_DAYS,
        },
    }


def _render_summary(profile: dict[str, Any], status: str = "current") -> str:
    summary = profile.get("summary", {})
    lines = summary.get("lines", []) if isinstance(summary, dict) else []
    evidence = profile.get("evidence", [])
    rendered = [
        "# IMO Project Profile",
        "",
        f"Status at generation: {status}",
        f"Generated at: {profile.get('generated_at', '-')}",
        "",
        "## Context Summary",
        "",
    ]
    for line in lines[:MAX_CONTEXT_LINES]:
        rendered.append(f"- {line}")
    rendered.extend(["", "## Evidence", ""])
    if isinstance(evidence, list) and evidence:
        for item in evidence[:10]:
            if isinstance(item, dict):
                rendered.append(f"- `{item.get('path', '-')}`: {item.get('reason', '-')}")
    else:
        rendered.append("- No evidence recorded.")
    rendered.append("")
    return "\n".join(rendered)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_profile(profile: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    _write_json(CURRENT_PATH, profile)
    SUMMARY_PATH.write_text(_render_summary(profile), encoding="utf-8")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "profile_id": profile["profile_id"],
        "generated_at": profile["generated_at"],
        "status_hint": "current",
        "current_path": ".imo/.runtime/project-profile/current.json",
        "summary_path": ".imo/.runtime/project-profile/summary.md",
    }
    _write_json(MANIFEST_PATH, manifest)


def _load_profile() -> tuple[dict[str, Any] | None, str | None]:
    if not CURRENT_PATH.exists():
        return None, "missing"
    try:
        data = json.loads(CURRENT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"invalid profile json: {exc}"
    if not isinstance(data, dict):
        return None, "profile root must be an object"
    return data, None


def _validate_profile(profile: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if profile.get("schema_version") != SCHEMA_VERSION:
        errors.append("unsupported schema_version")
    for field in ("profile_id", "repo_root", "generated_at"):
        if not isinstance(profile.get(field), str) or not profile.get(field):
            errors.append(f"{field} must be a non-empty string")
    if not isinstance(profile.get("git"), dict):
        errors.append("git must be an object")
    fingerprint = profile.get("source_fingerprint")
    if not isinstance(fingerprint, dict) or not isinstance(fingerprint.get("digest"), str):
        errors.append("source_fingerprint.digest must be set")
    summary = profile.get("summary")
    if not isinstance(summary, dict):
        errors.append("summary must be an object")
    else:
        lines = summary.get("lines")
        if not isinstance(lines, list) or not all(isinstance(line, str) and line.strip() for line in lines):
            errors.append("summary.lines must be a non-empty string list")
    if not isinstance(profile.get("conventions"), dict):
        errors.append("conventions must be an object")
    if not isinstance(profile.get("evidence"), list):
        errors.append("evidence must be a list")
    if SUMMARY_PATH.exists() and len(SUMMARY_PATH.read_text(encoding="utf-8")) > MAX_CONTEXT_CHARS * 3:
        errors.append("summary.md exceeds bounded context size")
    return errors


def status_info() -> dict[str, Any]:
    profile, load_error = _load_profile()
    if profile is None:
        if load_error == "missing":
            return {"status": "missing", "reason": f"no profile found at {DISPLAY_DIR}/current.json"}
        return {"status": "invalid", "reason": load_error}

    errors = _validate_profile(profile)
    if not SUMMARY_PATH.exists():
        errors.append("summary.md is missing")
    if errors:
        return {"status": "invalid", "reason": "; ".join(errors)}

    reasons: list[str] = []
    current_fingerprint = _source_fingerprint()
    saved_fingerprint = profile.get("source_fingerprint", {})
    if saved_fingerprint.get("digest") != current_fingerprint.get("digest"):
        reasons.append("selected source fingerprint changed")

    git = profile.get("git", {})
    current_git = _git_info()
    if isinstance(git, dict) and git.get("head") != current_git.get("head"):
        reasons.append("git head changed")

    generated_at = _parse_time(profile.get("generated_at"))
    if generated_at is None:
        return {"status": "invalid", "reason": "generated_at is not a valid timestamp"}
    age = datetime.now(timezone.utc) - generated_at
    if age.days > PROFILE_TTL_DAYS:
        reasons.append(f"profile older than {PROFILE_TTL_DAYS} days")

    if reasons:
        return {
            "status": "stale",
            "reason": "; ".join(reasons),
            "profile_id": profile.get("profile_id"),
            "generated_at": profile.get("generated_at"),
        }
    return {
        "status": "current",
        "reason": "profile matches cheap fingerprint checks",
        "profile_id": profile.get("profile_id"),
        "generated_at": profile.get("generated_at"),
    }


def _bounded_context_lines(lines: list[str], *, max_lines: int, max_chars: int) -> list[str]:
    bounded: list[str] = []
    total = 0
    for line in lines:
        compact = " ".join(line.strip().split())
        if not compact:
            continue
        if len(compact) > max_chars:
            compact = compact[: max_chars - 3].rstrip() + "..."
        next_total = total + len(compact)
        if bounded and next_total > max_chars:
            break
        bounded.append(compact)
        total = next_total
        if len(bounded) >= max_lines:
            break
    return bounded


def context_lines(max_lines: int = MAX_CONTEXT_LINES, max_chars: int = MAX_CONTEXT_CHARS) -> list[str]:
    info = status_info()
    status = info["status"]
    if status == "missing":
        return ["- status: missing (run `./imo profile refresh` after major project updates)."]
    if status == "invalid":
        return [f"- status: invalid ({info.get('reason', 'unknown error')})."]

    try:
        profile = json.loads(CURRENT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ["- status: invalid (profile could not be read)."]
    summary = profile.get("summary", {})
    raw_lines = summary.get("lines", []) if isinstance(summary, dict) else []
    lines = [f"- status: {status} ({info.get('reason', '-')})."]
    if status == "stale":
        lines.append("- refresh recommended: run `./imo profile refresh`.")
    lines.append("- Chameleon use: profile is guidance; inspect neighboring files and existing tests before editing.")
    for line in raw_lines[:MAX_CONTEXT_LINES]:
        if isinstance(line, str) and line.strip():
            lines.append(f"- {line.strip()}")
    return _bounded_context_lines(lines, max_lines=max_lines, max_chars=max_chars)


def _print_status(as_json: bool) -> int:
    info = status_info()
    if as_json:
        print(json.dumps(info, ensure_ascii=True, indent=2, sort_keys=True))
    else:
        print(f"status\t{info['status']}")
        print(f"reason\t{info.get('reason', '-')}")
        if info.get("profile_id"):
            print(f"profile_id\t{info['profile_id']}")
        if info.get("generated_at"):
            print(f"generated_at\t{info['generated_at']}")
    return 1 if info["status"] == "invalid" else 0


def _refresh() -> int:
    profile = build_profile()
    _write_profile(profile)
    print(f"[imo profile] refreshed {DISPLAY_DIR}/current.json")
    print(profile["profile_id"])
    return 0


def _inspect(as_json: bool) -> int:
    info = status_info()
    if info["status"] == "missing":
        print(f"[imo profile] {info['reason']}")
        return 0
    if info["status"] == "invalid":
        print(f"[imo profile] {info['reason']}", file=sys.stderr)
        return 1
    if as_json:
        profile, _ = _load_profile()
        print(json.dumps(profile, ensure_ascii=True, indent=2, sort_keys=True))
        return 0
    print(SUMMARY_PATH.read_text(encoding="utf-8"), end="")
    if info["status"] == "stale":
        print(f"\n[imo profile] stale: {info.get('reason', '-')}")
    return 0


def _clear() -> int:
    if RUNTIME_DIR.exists():
        shutil.rmtree(RUNTIME_DIR)
        print(f"[imo profile] cleared {DISPLAY_DIR}")
    else:
        print(f"[imo profile] no profile state found at {DISPLAY_DIR}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print(_usage(), end="")
        return 0

    command = args[0]
    rest = args[1:]
    if command == "refresh" and not rest:
        return _refresh()
    if command == "clear" and not rest:
        return _clear()
    if command == "status":
        if rest in ([], ["--json"]):
            return _print_status(as_json=rest == ["--json"])
    if command == "inspect":
        if rest in ([], ["--json"]):
            return _inspect(as_json=rest == ["--json"])

    print(_usage(), end="", file=sys.stderr)
    print(f"\nUnsupported profile command: {' '.join(args)}", file=sys.stderr)
    return 64


if __name__ == "__main__":
    raise SystemExit(main())
