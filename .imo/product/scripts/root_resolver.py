#!/usr/bin/env python3
"""Resolve IMO source, global, and project roots."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Iterable


SOURCE_ROOT = Path(__file__).resolve().parents[3]
PROJECT_MARKER_REL = Path(".imo/project.json")
PROJECT_RUNTIME_REL = Path(".imo/.runtime")
GLOBAL_RUNTIME_REL = Path("runtime")


def _as_root(path: str | os.PathLike[str]) -> Path:
    return Path(path).expanduser().resolve()


def resolve_global_root() -> Path:
    override = os.environ.get("IMO_GLOBAL_ROOT")
    return _as_root(override) if override else _as_root("~/.imo")


def _walk_roots(start: Path) -> Iterable[Path]:
    current = start if start.is_dir() else start.parent
    current = current.resolve()
    while True:
        yield current
        if (current / ".git").exists() or current.parent == current:
            break
        current = current.parent


def resolve_project_root(
    start: str | os.PathLike[str] | None = None,
    *,
    explicit: str | os.PathLike[str] | None = None,
) -> Path | None:
    if explicit is not None:
        return _as_root(explicit)

    override = os.environ.get("IMO_PROJECT_ROOT")
    if override:
        return _as_root(override)

    roots = list(_walk_roots(_as_root(start or os.getcwd())))
    for root in roots:
        if (root / PROJECT_MARKER_REL).is_file():
            return root
    for root in roots:
        if (root / ".trellis/workflow.md").is_file() or (root / ".trellis/tasks").is_dir():
            return root
    return None


def project_root_or_source(start: str | os.PathLike[str] | None = None) -> Path:
    return resolve_project_root(start) or SOURCE_ROOT


def project_runtime_root(project_root: Path) -> Path:
    return project_root / PROJECT_RUNTIME_REL


def global_runtime_root(global_root: Path | None = None) -> Path:
    return (global_root or resolve_global_root()) / GLOBAL_RUNTIME_REL


def project_id_for_path(project_root: Path) -> str:
    raw = str(project_root.resolve()).encode("utf-8")
    return "project-" + hashlib.sha256(raw).hexdigest()[:16]


def load_project_marker(project_root: Path) -> dict[str, Any] | None:
    marker = project_root / PROJECT_MARKER_REL
    if not marker.is_file():
        return None
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def project_marker_payload(project_root: Path) -> dict[str, Any]:
    existing = load_project_marker(project_root)
    project_id = existing.get("project_id") if isinstance(existing, dict) else None
    if not isinstance(project_id, str) or not project_id.strip():
        project_id = project_id_for_path(project_root)
    return {
        "schema_version": 1,
        "project_id": project_id,
        "install_mode": "project",
        "source": "imo",
    }


def project_marker_text(project_root: Path) -> str:
    return json.dumps(project_marker_payload(project_root), indent=2, sort_keys=True) + "\n"
