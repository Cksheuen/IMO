from __future__ import annotations

import json
import sys
from typing import Any
from uuid import uuid4

from learning_common import (
    CONFIDENCE_LEVELS,
    PRIVACY_CLASSES,
    SCOPES,
    SIGNALS_DISPLAY_PATH,
    SIGNALS_PATH,
    _now,
    _record_event,
    _require_value,
    _value,
)


def _parse_signal_add(args: list[str]) -> tuple[dict[str, str | None], list[str]]:
    values: dict[str, str | None] = {
        "summary": None,
        "source_agent": "manual",
        "scope": "project",
        "privacy": "project_private",
        "confidence": "low",
        "ttl": None,
        "evidence_ref": None,
    }
    errors: list[str] = []
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--summary":
            value, index = _require_value(args, index, option)
            values["summary"] = value
        elif option == "--source-agent":
            value, index = _require_value(args, index, option)
            values["source_agent"] = value
        elif option == "--scope":
            value, index = _require_value(args, index, option)
            values["scope"] = value
        elif option == "--privacy":
            value, index = _require_value(args, index, option)
            values["privacy"] = value
        elif option == "--confidence":
            value, index = _require_value(args, index, option)
            values["confidence"] = value
        elif option == "--ttl":
            value, index = _require_value(args, index, option)
            values["ttl"] = None if value == "null" else value
        elif option == "--evidence-ref":
            value, index = _require_value(args, index, option)
            values["evidence_ref"] = value
        else:
            errors.append(f"unsupported signal add option: {option}")
            index += 1

    return values, errors


def _validate_signal_fields(values: dict[str, str | None]) -> list[str]:
    errors: list[str] = []
    summary = values.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        errors.append("--summary is required")

    source_agent = values.get("source_agent")
    if not isinstance(source_agent, str) or not source_agent.strip():
        errors.append("--source-agent must not be empty")

    scope = values.get("scope")
    if scope not in SCOPES:
        errors.append(f"--scope must be one of: {', '.join(sorted(SCOPES))}")

    privacy = values.get("privacy")
    if privacy not in PRIVACY_CLASSES:
        errors.append(f"--privacy must be one of: {', '.join(sorted(PRIVACY_CLASSES))}")

    confidence = values.get("confidence")
    if confidence not in CONFIDENCE_LEVELS:
        errors.append(f"--confidence must be one of: {', '.join(sorted(CONFIDENCE_LEVELS))}")

    return errors


def _load_signals() -> tuple[list[dict[str, Any]], str | None]:
    if not SIGNALS_PATH.exists():
        return [], f"no raw signals found at {SIGNALS_DISPLAY_PATH}"

    items: list[dict[str, Any]] = []
    try:
        with SIGNALS_PATH.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    item = json.loads(stripped)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"invalid json in {SIGNALS_DISPLAY_PATH}:{line_number}: {exc}"
                    ) from exc
                if not isinstance(item, dict):
                    raise ValueError(f"{SIGNALS_DISPLAY_PATH}:{line_number} must be an object")
                items.append(item)
    except OSError as exc:
        raise ValueError(f"failed to read {SIGNALS_DISPLAY_PATH}: {exc}") from exc

    return items, None


def _list_signals() -> int:
    try:
        items, empty_reason = _load_signals()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'raw signal list is empty'}")
        return 0

    print("id\tcreated_at\tscope\tprivacy\tconfidence\tsource_agent\tsummary")
    for item in items:
        print(
            "\t".join(
                [
                    _value(item, "id"),
                    _value(item, "created_at"),
                    _value(item, "scope"),
                    _value(item, "privacy"),
                    _value(item, "confidence"),
                    _value(item, "source_agent"),
                    _value(item, "summary"),
                ]
            )
        )
    return 0


def _add_signal(args: list[str]) -> int:
    values, parse_errors = _parse_signal_add(args)
    errors = parse_errors + _validate_signal_fields(values)
    if errors:
        for error in errors:
            print(f"[imo learning] {error}", file=sys.stderr)
        return 64

    signal = {
        "id": f"signal-{uuid4().hex}",
        "created_at": _now(),
        "source_agent": str(values["source_agent"]).strip(),
        "scope": values["scope"],
        "privacy": values["privacy"],
        "confidence": values["confidence"],
        "ttl": values["ttl"],
        "summary": str(values["summary"]).strip(),
    }
    if values.get("evidence_ref"):
        signal["evidence_ref"] = str(values["evidence_ref"]).strip()

    try:
        SIGNALS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with SIGNALS_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(signal, ensure_ascii=True, sort_keys=True) + "\n")
    except OSError as exc:
        print(f"[imo learning] failed to write {SIGNALS_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1

    _record_event(
        "signal_created",
        signal_id=signal["id"],
        scope=signal["scope"],
        privacy=signal["privacy"],
        confidence=signal["confidence"],
    )
    print(signal["id"])
    return 0
