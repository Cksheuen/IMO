#!/usr/bin/env python3
"""Concept flow mode management: enable / disable / status."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

CONFIG_PATH = Path.home() / ".claude" / "concept-flow-config.json"
DEFAULT_STATUS = {"enabled": True, "updated_at": None}


def utc_now_iso8601() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def load_status() -> dict[str, bool | str | None]:
    if not CONFIG_PATH.is_file():
        return dict(DEFAULT_STATUS)

    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    enabled = data.get("enabled", True)
    updated_at = data.get("updated_at")
    return {
        "enabled": bool(enabled),
        "updated_at": updated_at if isinstance(updated_at, str) else None,
    }


def save_status(enabled: bool) -> dict[str, bool | str]:
    status = {"enabled": enabled, "updated_at": utc_now_iso8601()}
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=CONFIG_PATH.parent,
        prefix=f"{CONFIG_PATH.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        tmp_path = Path(handle.name)
        json.dump(status, handle, indent=2)
        handle.write("\n")

    os.replace(tmp_path, CONFIG_PATH)
    return status


def print_status(status: dict[str, bool | str | None]) -> None:
    print(json.dumps(status))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage concept flow mode configuration."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("enable", help="Enable concept flow mode.")
    subparsers.add_parser("disable", help="Disable concept flow mode.")
    subparsers.add_parser("status", help="Show current concept flow mode.")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "enable":
        print_status(save_status(True))
    elif args.command == "disable":
        print_status(save_status(False))
    elif args.command == "status":
        print_status(load_status())
    else:
        parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
