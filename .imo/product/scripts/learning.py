#!/usr/bin/env python3
"""Read-only IMO learning-plane CLI."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DIGEST_PATH = ROOT / ".imo/.runtime/learning/digest.json"
DISPLAY_PATH = ".imo/.runtime/learning/digest.json"


def _usage() -> str:
    return """Usage:
  scripts/imo.sh learning list
  scripts/imo.sh learning inspect <id>

Read-only commands for active learning digest state.
"""


def _load_digest() -> tuple[list[dict[str, Any]], str | None]:
    if not DIGEST_PATH.exists():
        return [], f"no active digest found at {DISPLAY_PATH}"

    try:
        with DIGEST_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid json in {DISPLAY_PATH}: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"failed to read {DISPLAY_PATH}: {exc}") from exc

    if isinstance(data, list):
        raw_items = data
    elif isinstance(data, dict):
        raw_items = data.get("items", data.get("digest_items", []))
    else:
        raise ValueError(f"{DISPLAY_PATH} must be a JSON object or list")

    if not isinstance(raw_items, list):
        raise ValueError(f"{DISPLAY_PATH} items must be a list")

    items: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            raise ValueError(f"{DISPLAY_PATH} item {index} must be an object")
        items.append(item)
    return items, None


def _value(item: dict[str, Any], key: str, default: str = "-") -> str:
    value = item.get(key)
    if value is None or value == "":
        return default
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=True, sort_keys=True)


def _list_items() -> int:
    try:
        items, empty_reason = _load_digest()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'active digest is empty'}")
        return 0

    print("id\tstatus\tscope\tpriority\tsummary")
    for item in items:
        print(
            "\t".join(
                [
                    _value(item, "id"),
                    _value(item, "status"),
                    _value(item, "scope"),
                    _value(item, "priority"),
                    _value(item, "summary"),
                ]
            )
        )
    return 0


def _inspect_item(item_id: str) -> int:
    try:
        items, empty_reason = _load_digest()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'active digest is empty'}", file=sys.stderr)
        return 1

    for item in items:
        if item.get("id") == item_id:
            print(json.dumps(item, ensure_ascii=True, indent=2, sort_keys=True))
            return 0

    print(f"[imo learning] digest item not found: {item_id}", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print(_usage(), end="")
        return 0

    command = args[0]
    if command == "list" and len(args) == 1:
        return _list_items()
    if command == "inspect" and len(args) == 2:
        return _inspect_item(args[1])

    print(_usage(), end="", file=sys.stderr)
    print(f"\nUnsupported learning command: {' '.join(args)}", file=sys.stderr)
    return 64


if __name__ == "__main__":
    raise SystemExit(main())

