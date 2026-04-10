#!/usr/bin/env python3
"""Report size and role of runtime-heavy local directories."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path.home() / ".claude"
TARGETS = {
    "plugins": {
        "path": ROOT / "plugins",
        "role": "Plugin caches, marketplace clones, local plugin data.",
        "suggestion": "Keep out of git; inspect when plugin cache or marketplace clones grow unexpectedly.",
    },
    "projects": {
        "path": ROOT / "projects",
        "role": "Per-project runtime/session state keyed by normalized project paths.",
        "suggestion": "Keep out of git; audit when old project/session directories accumulate.",
    },
    "tasks": {
        "path": ROOT / "tasks",
        "role": "This repo project's local task instances and task facts.",
        "suggestion": "Run task-audit when duplicate themes or draft tasks start piling up.",
    },
    "file-history": {
        "path": ROOT / "file-history",
        "role": "Runtime file history snapshots for local sessions.",
        "suggestion": "Keep out of git; inspect only when history growth impacts disk usage.",
    },
    "specs": {
        "path": ROOT / "specs",
        "role": "Generated or working specification artifacts for local workflows.",
        "suggestion": "Review periodically; archive or prune only with manual intent.",
    },
}


def dir_size_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for child in path.rglob("*"):
        if child.is_file():
            try:
                total += child.stat().st_size
            except OSError:
                continue
    return total


def humanize(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{size}B"


def main() -> int:
    report = {"root": str(ROOT), "directories": []}
    for name, meta in TARGETS.items():
        path = meta["path"]
        size = dir_size_bytes(path)
        report["directories"].append(
            {
                "name": name,
                "path": str(path),
                "exists": path.exists(),
                "size_bytes": size,
                "size_human": humanize(size),
                "role": meta["role"],
                "suggestion": meta["suggestion"],
            }
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
