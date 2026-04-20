#!/usr/bin/env python3
"""Concept flow mode management: enable / disable / status."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CONFIG_FILENAME = "concept-flow-config.json"
CLAUDE_DIR = Path.home() / ".claude"
GLOBAL_CONFIG_PATH = CLAUDE_DIR / CONFIG_FILENAME
DEFAULT_STATUS = {"enabled": True, "updated_at": None}
PROJECT_ROOT_MARKERS = (
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    ".git",
)


def utc_now_iso8601() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def resolve_project_root(cwd: Path) -> Path | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
        )
        root = result.stdout.strip()
        if result.returncode == 0 and root:
            return Path(root).resolve()
    except Exception:
        pass

    try:
        current = cwd.resolve()
    except OSError:
        return None

    for candidate in (current, *current.parents):
        if any((candidate / marker).exists() for marker in PROJECT_ROOT_MARKERS):
            return candidate
    return None


def project_config_path(project_root: Path) -> Path:
    if project_root.name == ".claude":
        return project_root / CONFIG_FILENAME
    return project_root / ".claude" / CONFIG_FILENAME


def load_config(path: Path) -> dict[str, bool | str | None] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    enabled = data.get("enabled", True)
    updated_at = data.get("updated_at")
    return {
        "enabled": bool(enabled),
        "updated_at": updated_at if isinstance(updated_at, str) else None,
    }


def save_status(path: Path, enabled: bool) -> dict[str, bool | str]:
    status = {"enabled": enabled, "updated_at": utc_now_iso8601()}
    path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f"{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        tmp_path = Path(handle.name)
        json.dump(status, handle, indent=2)
        handle.write("\n")

    os.replace(tmp_path, path)
    return status


def build_status_payload(
    scope: str,
    enabled: bool,
    updated_at: str | None,
    config_path: Path | None,
    project_root: Path | None,
) -> dict[str, bool | str | None]:
    return {
        "scope": scope,
        "enabled": enabled,
        "updated_at": updated_at,
        "config_path": str(config_path) if config_path is not None else None,
        "project_root": str(project_root) if project_root is not None else None,
    }


def resolve_write_target(scope: str, cwd: Path) -> tuple[Path, str, Path | None]:
    if scope == "global":
        return GLOBAL_CONFIG_PATH, "global", None

    project_root = resolve_project_root(cwd)
    if project_root is None:
        sys.stderr.write(
            "[concept-flow-mode] project root not found; falling back to global scope\n"
        )
        return GLOBAL_CONFIG_PATH, "global", None

    return project_config_path(project_root), "project", project_root


def load_status(scope: str, cwd: Path) -> dict[str, bool | str | None]:
    project_root = resolve_project_root(cwd) if scope == "project" else None

    if scope == "global":
        config = load_config(GLOBAL_CONFIG_PATH)
        if config is None:
            return build_status_payload("default", True, None, None, None)
        return build_status_payload(
            "global",
            bool(config["enabled"]),
            config["updated_at"] if isinstance(config["updated_at"], str) else None,
            GLOBAL_CONFIG_PATH,
            None,
        )

    if project_root is not None:
        project_path = project_config_path(project_root)
        config = load_config(project_path)
        if config is not None:
            return build_status_payload(
                "project",
                bool(config["enabled"]),
                config["updated_at"] if isinstance(config["updated_at"], str) else None,
                project_path,
                project_root,
            )

    config = load_config(GLOBAL_CONFIG_PATH)
    if config is not None:
        return build_status_payload(
            "global",
            bool(config["enabled"]),
            config["updated_at"] if isinstance(config["updated_at"], str) else None,
            GLOBAL_CONFIG_PATH,
            project_root,
        )

    return build_status_payload("default", True, None, None, project_root)


def print_status(status: dict[str, Any]) -> None:
    print(json.dumps(status))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage concept flow mode configuration."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common_args(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument(
            "--scope",
            choices=("project", "global"),
            default="project",
            help="Configuration scope to read/write. Defaults to project.",
        )
        command_parser.add_argument(
            "--cwd",
            default=None,
            help="Working directory used to resolve project scope. Defaults to os.getcwd().",
        )

    add_common_args(subparsers.add_parser("enable", help="Enable concept flow mode."))
    add_common_args(subparsers.add_parser("disable", help="Disable concept flow mode."))
    add_common_args(subparsers.add_parser("status", help="Show current concept flow mode."))

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    cwd = Path(args.cwd) if args.cwd else Path(os.getcwd())

    if args.command == "enable":
        config_path, effective_scope, project_root = resolve_write_target(args.scope, cwd)
        status = save_status(config_path, True)
        print_status(
            build_status_payload(
                effective_scope,
                True,
                status["updated_at"] if isinstance(status["updated_at"], str) else None,
                config_path,
                project_root,
            )
        )
    elif args.command == "disable":
        config_path, effective_scope, project_root = resolve_write_target(args.scope, cwd)
        status = save_status(config_path, False)
        print_status(
            build_status_payload(
                effective_scope,
                False,
                status["updated_at"] if isinstance(status["updated_at"], str) else None,
                config_path,
                project_root,
            )
        )
    elif args.command == "status":
        print_status(load_status(args.scope, cwd))
    else:
        parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
