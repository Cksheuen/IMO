#!/usr/bin/env python3
"""Validate IMO observability runtime contracts."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / ".imo/runtime/observability/CONTRACT.md"
SCHEMA_PATH = ROOT / ".imo/runtime/observability/event.schema.json"
REQUIRED_FIELDS = {
    "schema_version",
    "id",
    "created_at",
    "event_type",
    "trace_id",
    "span_id",
    "plane",
    "component",
    "operation",
    "phase",
    "outcome",
    "privacy",
}
REQUIRED_EVENT_TYPES = {
    "command_start",
    "command_end",
    "verify_start",
    "verify_check_start",
    "verify_check_end",
    "verify_end",
    "metrics_viewed",
    "orchestrate_worker_event",
}
REQUIRED_PLANES = {"command", "verify", "learning", "profile", "provider", "hook", "orchestrate"}
REQUIRED_OUTCOMES = {"ok", "error", "timeout", "skipped", "cancelled"}


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    errors: list[str] = []
    try:
        contract = CONTRACT_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"[observability contracts] failed to read {CONTRACT_PATH}: {exc}", file=sys.stderr)
        return 1

    for phrase in (
        "Events must not contain",
        "raw user prompts",
        "full command arguments",
        "Event writes can be disabled with `IMO_DISABLE_EVENTS=1`",
    ):
        if phrase not in contract:
            errors.append(f"contract missing required phrase: {phrase}")

    try:
        schema = _load_json(SCHEMA_PATH)
    except OSError as exc:
        print(f"[observability contracts] failed to read {SCHEMA_PATH}: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"[observability contracts] invalid json in {SCHEMA_PATH}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(schema, dict):
        errors.append("schema root must be an object")
        schema = {}
    if schema.get("type") != "object":
        errors.append("schema must declare type=object")
    if schema.get("additionalProperties") is not False:
        errors.append("schema must reject additionalProperties")
    required = set(schema.get("required", []))
    if REQUIRED_FIELDS - required:
        errors.append(f"schema missing required fields: {', '.join(sorted(REQUIRED_FIELDS - required))}")
    properties = schema.get("properties", {})
    if not isinstance(properties, dict):
        errors.append("schema properties must be an object")
        properties = {}
    event_values = set(properties.get("event_type", {}).get("enum", []))
    if REQUIRED_EVENT_TYPES - event_values:
        errors.append(f"schema missing event types: {', '.join(sorted(REQUIRED_EVENT_TYPES - event_values))}")
    plane_values = set(properties.get("plane", {}).get("enum", []))
    if REQUIRED_PLANES - plane_values:
        errors.append(f"schema missing planes: {', '.join(sorted(REQUIRED_PLANES - plane_values))}")
    outcome_values = set(properties.get("outcome", {}).get("enum", []))
    if REQUIRED_OUTCOMES - outcome_values:
        errors.append(f"schema missing outcomes: {', '.join(sorted(REQUIRED_OUTCOMES - outcome_values))}")

    if errors:
        for error in errors:
            print(f"[observability contracts] {error}", file=sys.stderr)
        return 1
    print("[observability contracts] ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
