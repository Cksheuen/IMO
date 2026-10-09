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
GLOBAL_PROJECTS_REL = Path("projects")


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


def _registered_project_roots(global_root: Path) -> list[Path]:
    try:
        registrations = list(global_root.glob("projects/*/project.json"))
    except OSError:
        return []
    roots: list[Path] = []
    for registration in registrations:
        try:
            data = json.loads(registration.read_text(encoding="utf-8"))
        except (OSError, ValueError, RuntimeError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if data.get("install_mode") != "global-zero-install":
            continue
        project_root = data.get("project_root")
        if not isinstance(project_root, str) or not project_root:
            continue
        try:
            resolved = Path(project_root).expanduser().resolve()
        except (OSError, ValueError, RuntimeError):
            continue
        if not resolved.is_dir():
            continue
        roots.append(resolved)
    return roots


def _is_ancestor(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


def _deepest_registered_root(start: Path, global_root: Path) -> Path | None:
    candidates = [
        root for root in _registered_project_roots(global_root) if _is_ancestor(root, start)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda root: len(root.parts))


def _is_global_marker(root: Path, global_root: Path) -> bool:
    try:
        return (root / ".imo").resolve() == global_root
    except (OSError, RuntimeError):
        return False


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

    resolved_start = _as_root(start or os.getcwd())
    global_root = resolve_global_root()
    roots = list(_walk_roots(resolved_start))

    local_root: Path | None = None
    for root in roots:
        if not _is_global_marker(root, global_root) and (root / PROJECT_MARKER_REL).is_file():
            local_root = root
            break
    if local_root is None:
        for root in roots:
            if not _is_global_marker(root, global_root) and (root / ".imo").is_dir():
                local_root = root
                break
    if local_root is None:
        for root in roots:
            if (root / ".git").exists():
                local_root = root
                break

    registered_root = _deepest_registered_root(resolved_start, global_root)

    if local_root is None:
        return registered_root
    if registered_root is None:
        return local_root
    if len(registered_root.parts) > len(local_root.parts):
        return registered_root
    return local_root


def project_root_or_source(start: str | os.PathLike[str] | None = None) -> Path:
    return resolve_project_root(start) or SOURCE_ROOT


def project_runtime_root(project_root: Path) -> Path:
    override = os.environ.get("IMO_PROJECT_RUNTIME_ROOT")
    if override:
        return _as_root(override)
    return resolve_global_root() / GLOBAL_PROJECTS_REL / project_id_for_path(project_root) / "runtime"


def project_state_root(project_root: Path) -> Path:
    return project_runtime_root(project_root).parent


def project_runtime_display(project_root: Path, relative: str | os.PathLike[str] | None = None) -> str:
    path = project_runtime_root(project_root)
    if relative is not None:
        path /= Path(relative)
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return str(path)


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
