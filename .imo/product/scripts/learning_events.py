#!/usr/bin/env python3
"""Local event helpers for IMO learning-plane observability."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[3]
EVENTS_PATH = ROOT / ".imo/.runtime/learning/events.jsonl"
EVENTS_DISPLAY_PATH = ".imo/.runtime/learning/events.jsonl"
EVENT_TYPES = {
    "signal_created",
    "activity_marked",
    "candidate_build_completed",
    "prepare_skipped",
    "prepare_completed",
    "inbox_viewed",
    "candidate_approved",
    "candidate_rejected",
    "digest_promoted",
    "digest_disabled",
    "digest_reset",
    "context_digest_injected",
}
COMPACT_FIELDS = {
    "signal_id",
    "candidate_id",
    "digest_id",
    "scope",
    "privacy",
    "confidence",
    "state",
    "reason",
    "created_count",
    "updated_count",
    "pending_count",
    "removed_count",
    "injected_count",
    "forced",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _compact_value(key: str, value: Any) -> Any:
    if isinstance(value, str):
        compact = " ".join(value.strip().split())
        if key == "reason" and len(compact) > 120:
            return compact[:117].rstrip() + "..."
        return compact
    return value


def _events_disabled() -> bool:
    return os.environ.get("IMO_DISABLE_LEARNING_EVENTS") == "1" or os.environ.get("IMO_DISABLE_EVENTS") == "1"


def write_event(event_type: str, source: str, **fields: Any) -> bool:
    if _events_disabled():
        return False
    if event_type not in EVENT_TYPES or not source.strip():
        return False

    event: dict[str, Any] = {
        "id": f"event-{uuid4().hex}",
        "created_at": _now(),
        "event_type": event_type,
        "source": source.strip(),
    }
    for key, value in fields.items():
        if key not in COMPACT_FIELDS or value is None or value == "":
            continue
        event[key] = _compact_value(key, value)

    try:
        EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=True, sort_keys=True) + "\n")
    except OSError:
        return False
    return True


def load_events() -> tuple[list[dict[str, Any]], str | None]:
    if not EVENTS_PATH.exists():
        return [], f"no learning events found at {EVENTS_DISPLAY_PATH}"

    events: list[dict[str, Any]] = []
    with EVENTS_PATH.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid json in {EVENTS_DISPLAY_PATH}:{line_number}: {exc}") from exc
            if not isinstance(event, dict):
                raise ValueError(f"{EVENTS_DISPLAY_PATH}:{line_number} must be an object")
            events.append(event)
    return events, None


def summarize_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    event_counts = {event_type: 0 for event_type in sorted(EVENT_TYPES)}
    prepare_skip_by_reason: dict[str, int] = {}
    candidate_created_count = 0
    candidate_updated_count = 0
    review_decisions = {"approved": 0, "rejected": 0}
    digest_controls = {"promoted": 0, "disabled": 0, "reset": 0}
    context_digest_injected_count = 0

    for event in events:
        event_type = event.get("event_type")
        if not isinstance(event_type, str) or event_type not in EVENT_TYPES:
            continue
        event_counts[event_type] += 1
        if event_type == "prepare_skipped":
            reason = event.get("reason")
            reason_key = reason if isinstance(reason, str) and reason else "unknown"
            prepare_skip_by_reason[reason_key] = prepare_skip_by_reason.get(reason_key, 0) + 1
        if event_type in {"candidate_build_completed", "prepare_completed"}:
            created = event.get("created_count")
            updated = event.get("updated_count")
            if isinstance(created, int):
                candidate_created_count += created
            if isinstance(updated, int):
                candidate_updated_count += updated
        if event_type == "candidate_approved":
            review_decisions["approved"] += 1
        if event_type == "candidate_rejected":
            review_decisions["rejected"] += 1
        if event_type == "digest_promoted":
            digest_controls["promoted"] += 1
        if event_type == "digest_disabled":
            digest_controls["disabled"] += 1
        if event_type == "digest_reset":
            digest_controls["reset"] += 1
        if event_type == "context_digest_injected":
            injected = event.get("injected_count")
            context_digest_injected_count += injected if isinstance(injected, int) else 1

    return {
        "schema_version": 1,
        "total_events": sum(event_counts.values()),
        "event_counts": event_counts,
        "prepare_skip_by_reason": prepare_skip_by_reason,
        "candidate_counts": {
            "created": candidate_created_count,
            "updated": candidate_updated_count,
        },
        "review_decisions": review_decisions,
        "digest_controls": digest_controls,
        "context_digest_injected_count": context_digest_injected_count,
        "safety": {
            "active_task_interruption_count": 0,
            "auto_promotion_count": 0,
        },
    }
