#!/usr/bin/env python3
"""Check tracked .imo references, key routes, and git tracking."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = "1.0.0"
MODULES_PATH = ".imo/product/skills/modules.json"
RULES_PATH = ".imo/product/rules/rules.json"

FIXED_ROUTES = [
    ".github/workflows/imo-verify.yml",
    ".imo/KNOWLEDGE.md",
    ".imo/README.md",
    ".imo/ARCHITECTURE.md",
    ".imo/BOUNDARY.md",
    ".imo/RUNBOOK.md",
    ".imo/UPDATE.md",
]

BACKTICK_RE = re.compile(r"`([^`]+)`")
PLACEHOLDER_CHARS = frozenset("*?<>{}[]")
TRAILING_PUNCT = ".,;:!?)]}\"'"
LEADING_PUNCT = "([{\'\""


def _clean_ref(text: str) -> str:
    text = text.strip()
    return text.rstrip(TRAILING_PUNCT).lstrip(LEADING_PUNCT).strip()


def _is_explicit_file(rel: str) -> bool:
    if not rel.startswith(".imo/"):
        return False
    if rel.endswith("/") or any(c in PLACEHOLDER_CHARS for c in rel):
        return False
    base = rel.rsplit("/", 1)[-1]
    return "." in base and base not in (".", "..")


def _extract_items(data: Any) -> list[dict]:
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        for key in ("modules", "rules", "items", "data", "surfaces"):
            val = data.get(key)
            if isinstance(val, list):
                return [d for d in val if isinstance(d, dict)]
        for val in data.values():
            if isinstance(val, list):
                return [d for d in val if isinstance(d, dict)]
    return []


def _norm_surface(surface: str, root: Path) -> str | None:
    surface = surface.strip()
    if not surface or "\x00" in surface or "\\" in surface:
        return None
    p = Path(surface)
    if p.is_absolute() or ".." in p.parts:
        return None
    rel = p.as_posix().rstrip("/") or "."
    if rel != ".imo" and not rel.startswith(".imo/"):
        return None
    resolved = (root / rel).resolve(strict=False)
    try:
        resolved.relative_to(root.resolve())
    except ValueError:
        return None
    return rel


def _collect_surfaces(root: Path) -> tuple[set[str], set[str], set[str], list[str]]:
    required: set[str] = set()
    dir_required: set[str] = set()
    scan_sources: set[str] = set()
    errors: list[str] = []

    for metadata_path, key in (
        (root / MODULES_PATH, "modules"),
        (root / RULES_PATH, "rules"),
    ):
        try:
            meta_rel = metadata_path.relative_to(root).as_posix()
        except ValueError:
            meta_rel = str(metadata_path)

        scan_sources.add(meta_rel)

        try:
            raw = metadata_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            errors.append(f"{meta_rel}: metadata file not found")
            continue
        except OSError as exc:
            errors.append(f"{meta_rel}: cannot read metadata file: {exc}")
            continue

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            errors.append(f"{meta_rel}: invalid JSON: {exc}")
            continue

        if not isinstance(data, dict):
            errors.append(f"{meta_rel}: top-level JSON value must be an object")
            continue

        items = data.get(key)
        if not isinstance(items, list):
            errors.append(f"{meta_rel}: top-level '{key}' must be a list")
            continue

        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                errors.append(f"{meta_rel}: {key}[{idx}] must be an object")
                continue

            owner_surface = item.get("owner_surface")
            if not isinstance(owner_surface, str) or not owner_surface.strip():
                errors.append(
                    f"{meta_rel}: {key}[{idx}] owner_surface must be a nonempty string"
                )
                continue

            rel = _norm_surface(owner_surface, root)
            if not rel:
                errors.append(f"{meta_rel}: {key}[{idx}] owner_surface is invalid")
                continue

            if key == "modules":
                required.add(rel)
                required.add(f"{rel}/SKILL.md")
                dir_required.add(rel)
                scan_sources.add(f"{rel}/SKILL.md")
            else:
                required.add(rel)
                scan_sources.add(rel)

    return required, dir_required, scan_sources, errors


def _scan_references(root: Path, docs: Iterable[str]) -> tuple[set[str], list[str]]:
    refs: set[str] = set()
    errors: set[str] = set()
    prohibited = frozenset("*?<>[]{}$#\\\0")

    for rel in docs:
        path = root / rel

        try:
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, ValueError) as exc:
            errors.add(f"{rel}: cannot scan references: {exc}")
            continue

        for match in BACKTICK_RE.finditer(text):
            cleaned = _clean_ref(match.group(1))
            if cleaned is None:
                continue

            if any(part == ".." for part in cleaned.replace("\\", "/").split("/")):
                errors.add(f"{rel}: invalid IMO reference: {cleaned}")
                continue

            if not cleaned.startswith(".imo") or any(
                ch.isspace() or ch in prohibited for ch in cleaned
            ):
                continue

            normalized = _norm_surface(cleaned, root)
            if normalized is None:
                errors.add(f"{rel}: invalid IMO reference: {cleaned}")
                continue

            refs.add(normalized)

    return refs, sorted(errors)


def _git_tracked(root: Path) -> set[str] | None:
    try:
        proc = subprocess.run(
            ["git", "ls-files", "--cached", "-z"],
            cwd=str(root),
            capture_output=True,
            check=False,
        )
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    return {p for p in proc.stdout.decode("utf-8", "replace").split("\0") if p}


def main() -> int:
    parser = argparse.ArgumentParser(description="Check tracked .imo references")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[3]), help="Repository root directory")
    parser.add_argument("--require-tracked", action="store_true", help="Require git tracking")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: root is not a directory: {root}", file=sys.stderr)
        return 1

    required: set[str] = set(FIXED_ROUTES)
    dir_required: set[str] = set()

    surf_req, surf_dirs, scan_sources, validation_errors = _collect_surfaces(root)
    required |= surf_req
    dir_required |= surf_dirs
    scan_sources.update(FIXED_ROUTES)
    reference_paths, reference_errors = _scan_references(root, scan_sources)
    required |= reference_paths
    validation_errors.extend(reference_errors)

    missing = sorted(
        p for p in required
        if (p in dir_required and not (root / p).is_dir())
        or (p not in dir_required and not (root / p).exists())
    )

    tracked = _git_tracked(root)
    if tracked is None:
        print("error: unable to determine git tracked files", file=sys.stderr)
        return 2

    def _norm(p):
        p = os.path.normpath(p)
        return p.replace(os.sep, "/") or "."

    tracked = {_norm(p) for p in tracked if p and p.strip()}
    required = sorted({_norm(p) for p in required})
    dir_required = {_norm(p) for p in (dir_required or [])}
    missing = sorted({_norm(p) for p in (missing or [])})

    untracked = []
    for path in required:
        if path in missing:
            continue
        full = os.path.join(root, path)
        if not os.path.exists(full):
            continue
        is_dir = path in dir_required or os.path.isdir(full)
        if is_dir:
            if path == ".":
                is_tracked = bool(tracked)
            else:
                prefix = path + "/"
                is_tracked = any(p == path or p.startswith(prefix) for p in tracked)
        else:
            is_tracked = path in tracked
        if not is_tracked:
            untracked.append(path)
    untracked = sorted(set(untracked))

    errors = list(validation_errors)
    errors.extend(f"missing: {p}" for p in missing)
    if args.require_tracked:
        errors.extend(f"untracked: {p}" for p in untracked)
    errors = sorted(set(errors))

    summary = {
        "required": len(required),
        "missing": len(missing),
        "untracked": len(untracked),
        "errors": len(errors),
    }

    if args.json:
        print(json.dumps({
            "schema_version": SCHEMA_VERSION,
            "root": str(root),
            "require_tracked": bool(args.require_tracked),
            "required": required,
            "missing": missing,
            "untracked": untracked,
            "errors": errors,
            "summary": summary,
        }, indent=2))
    else:
        print(f"required={len(required)} missing={len(missing)} untracked={len(untracked)} errors={len(errors)}")
        for error in errors:
            print(f"error: {error}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
