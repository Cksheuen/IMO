#!/usr/bin/env python3
"""Read-only task directory auditor for the local ~/.claude/tasks pool."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path


MODERN_FILES = {"prd.md", "context.md", "status.md", "feature-list.json"}
SPECIAL_FILES = {"design.md", "plan.md", "research.md", "implementation-plan.md", "gap-map.md"}
HEX_SUFFIX_RE = re.compile(r"-[0-9a-f]{8}$")
DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-(.+)$")
LEGACY_JSON_RE = re.compile(r"^\d+\.json$")


def classify_task_dir(path: Path) -> dict:
    files = {child.name for child in path.iterdir() if child.is_file()}

    modern = MODERN_FILES.issubset(files)
    legacy = any(LEGACY_JSON_RE.match(name) for name in files)
    special = bool(files & SPECIAL_FILES) and not modern
    draft = "draft-task-" in path.name

    flags = []
    if draft:
        flags.append("draft")
    if modern:
        flags.append("modern")
    elif legacy:
        flags.append("legacy")
    elif special:
        flags.append("special")
    else:
        flags.append("nonstandard")

    return {
        "name": path.name,
        "files": sorted(files),
        "flags": flags,
    }


def duplicate_key(name: str) -> str:
    match = DATE_PREFIX_RE.match(name)
    slug = match.group(1) if match else name
    return HEX_SUFFIX_RE.sub("", slug)


def build_report(root: Path) -> dict:
    task_dirs = sorted([p for p in root.iterdir() if p.is_dir()])
    entries = [classify_task_dir(path) for path in task_dirs]

    counts = defaultdict(int)
    duplicates = defaultdict(list)

    for entry in entries:
        for flag in entry["flags"]:
            counts[flag] += 1
        duplicates[duplicate_key(entry["name"])].append(entry["name"])

    duplicate_groups = {
        key: sorted(names)
        for key, names in sorted(duplicates.items())
        if len(names) > 1
    }

    return {
        "root": str(root),
        "total_dirs": len(entries),
        "counts": dict(sorted(counts.items())),
        "duplicate_groups": duplicate_groups,
        "entries": entries,
    }


def print_text_report(report: dict) -> None:
    print("Task Audit")
    print(f"Root: {report['root']}")
    print(f"Total directories: {report['total_dirs']}")

    print("\nCounts:")
    for key, value in report["counts"].items():
        print(f"- {key}: {value}")

    if report["duplicate_groups"]:
        print("\nDuplicate themes:")
        for key, names in report["duplicate_groups"].items():
            print(f"- {key}")
            for name in names:
                print(f"  - {name}")
    else:
        print("\nDuplicate themes:")
        print("- none")

    flagged = [entry for entry in report["entries"] if any(flag in entry["flags"] for flag in ("draft", "legacy", "nonstandard", "special"))]
    if flagged:
        print("\nFlagged directories:")
        for entry in flagged:
            print(f"- {entry['name']}: {', '.join(entry['flags'])}")
    else:
        print("\nFlagged directories:")
        print("- none")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a Claude tasks directory without modifying it.")
    parser.add_argument("--root", default=str(Path.home() / ".claude" / "tasks"), help="Tasks root to audit.")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON.")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"tasks root not found: {root}")

    report = build_report(root)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
