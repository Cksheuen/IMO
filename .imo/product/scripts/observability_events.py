#!/usr/bin/env python3
"""Local event helpers for IMO observability."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import time
from typing import Any
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[3]
EVENTS_DIR = ROOT / ".imo/.runtime/observability/events"
EVENTS_DISPLAY_DIR = ".imo/.runtime/observability/events"
SCHEMA_VERSION = 1
EVENT_TYPES = {
    "command_start",
    "command_end",
    "verify_start",
    "verify_check_start",
    "verify_check_end",
    "verify_end",
    "metrics_viewed",
    "orchestrate_worker_event",
}
PLANES = {"command", "verify", "learning", "profile", "provider", "hook", "orchestrate"}
PHASES = {"start", "progress", "end", "skip"}
OUTCOMES = {"ok", "error", "timeout", "skipped", "cancelled"}
PRIVACY_CLASSES = {"public", "project_private", "sensitive"}
COMPACT_FIELDS = {
    "parent_span_id",
    "duration_ms",
    "exit_code",
    "error_kind",
    "command",
    "check_label",
    "status",
    "reason",
    "count",
    "item_count",
    "pending_count",
    "source",
    "source_event_type",
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def now_text() -> str:
    return now().isoformat().replace("+00:00", "Z")


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def new_trace_id() -> str:
    return f"trace-{uuid4().hex}"


def new_span_id() -> str:
    return f"span-{uuid4().hex[:16]}"


def _events_disabled() -> bool:
    return os.environ.get("IMO_DISABLE_EVENTS") == "1" or os.environ.get("IMO_DISABLE_OBSERVABILITY_EVENTS") == "1"


def _date_path(created_at: str | None = None) -> Path:
    if created_at:
        day = created_at[:10]
    else:
        day = now().date().isoformat()
    return EVENTS_DIR / f"{day}.jsonl"


def _compact_value(key: str, value: Any) -> Any:
    if isinstance(value, str):
        compact = " ".join(value.strip().split())
        if key == "reason" and len(compact) > 160:
            return compact[:157].rstrip() + "..."
        return compact
    return value


def _clean_optional_fields(fields: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in fields.items():
        if key not in COMPACT_FIELDS or value is None or value == "":
            continue
        clean[key] = _compact_value(key, value)
    return clean


def write_event(
    event_type: str,
    *,
    plane: str,
    component: str,
    operation: str,
    phase: str,
    outcome: str = "ok",
    privacy: str = "project_private",
    trace_id: str | None = None,
    span_id: str | None = None,
    **fields: Any,
) -> bool:
    if _events_disabled():
        return False
    if event_type not in EVENT_TYPES:
        return False
    if plane not in PLANES or phase not in PHASES or outcome not in OUTCOMES or privacy not in PRIVACY_CLASSES:
        return False
    if not component.strip() or not operation.strip():
        return False

    created_at = now_text()
    event: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "id": f"event-{uuid4().hex}",
        "created_at": created_at,
        "event_type": event_type,
        "trace_id": trace_id or os.environ.get("IMO_TRACE_ID") or new_trace_id(),
        "span_id": span_id or new_span_id(),
        "plane": plane,
        "component": component.strip(),
        "operation": operation.strip(),
        "phase": phase,
        "outcome": outcome,
        "privacy": privacy,
    }
    event.update(_clean_optional_fields(fields))

    try:
        path = _date_path(created_at)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=True, sort_keys=True) + "\n")
    except OSError:
        return False
    return True


def parse_since(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip().lower()
    if not raw:
        return None
    unit = raw[-1]
    try:
        amount = int(raw[:-1])
    except ValueError as exc:
        raise ValueError("--since must be a duration like 30m, 24h, or 7d") from exc
    if amount < 0:
        raise ValueError("--since must not be negative")
    if unit == "m":
        delta = timedelta(minutes=amount)
    elif unit == "h":
        delta = timedelta(hours=amount)
    elif unit == "d":
        delta = timedelta(days=amount)
    else:
        raise ValueError("--since must use m, h, or d")
    return now() - delta


def _parse_created_at(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def load_events(since: datetime | None = None) -> tuple[list[dict[str, Any]], str | None]:
    if not EVENTS_DIR.exists():
        return [], f"no observability events found at {EVENTS_DISPLAY_DIR}"

    events: list[dict[str, Any]] = []
    for path in sorted(EVENTS_DIR.glob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    event = json.loads(stripped)
                except json.JSONDecodeError as exc:
                    display = f"{EVENTS_DISPLAY_DIR}/{path.name}"
                    raise ValueError(f"invalid json in {display}:{line_number}: {exc}") from exc
                if not isinstance(event, dict):
                    display = f"{EVENTS_DISPLAY_DIR}/{path.name}"
                    raise ValueError(f"{display}:{line_number} must be an object")
                created_at = _parse_created_at(event.get("created_at"))
                if since is not None and (created_at is None or created_at < since):
                    continue
                events.append(event)
    return events, None


def summarize_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    event_counts = {event_type: 0 for event_type in sorted(EVENT_TYPES)}
    plane_counts: dict[str, int] = {}
    outcome_counts = {outcome: 0 for outcome in sorted(OUTCOMES)}
    command_counts: dict[str, int] = {}
    failures: list[dict[str, Any]] = []
    durations: list[int] = []
    latest_event_at = None

    for event in events:
        event_type = event.get("event_type")
        if isinstance(event_type, str) and event_type in event_counts:
            event_counts[event_type] += 1
        plane = event.get("plane")
        if isinstance(plane, str):
            plane_counts[plane] = plane_counts.get(plane, 0) + 1
        outcome = event.get("outcome")
        if isinstance(outcome, str) and outcome in outcome_counts:
            outcome_counts[outcome] += 1
        command = event.get("command") or event.get("operation")
        if isinstance(command, str) and command:
            command_counts[command] = command_counts.get(command, 0) + 1
        duration = event.get("duration_ms")
        if isinstance(duration, int):
            durations.append(duration)
        created_at = event.get("created_at")
        if isinstance(created_at, str) and (latest_event_at is None or created_at > latest_event_at):
            latest_event_at = created_at
        if outcome in {"error", "timeout", "cancelled"}:
            failures.append(
                {
                    "created_at": event.get("created_at"),
                    "trace_id": event.get("trace_id"),
                    "event_type": event_type,
                    "operation": event.get("operation"),
                    "error_kind": event.get("error_kind", "-"),
                    "exit_code": event.get("exit_code", "-"),
                }
            )

    avg_duration = round(sum(durations) / len(durations), 2) if durations else 0
    return {
        "schema_version": 1,
        "total_events": len(events),
        "latest_event_at": latest_event_at,
        "event_counts": event_counts,
        "plane_counts": plane_counts,
        "outcome_counts": outcome_counts,
        "command_counts": command_counts,
        "failure_count": len(failures),
        "failures": failures[-20:],
        "duration": {
            "count": len(durations),
            "avg_ms": avg_duration,
            "max_ms": max(durations) if durations else 0,
        },
    }


def events_for_trace(events: list[dict[str, Any]], trace_id: str) -> list[dict[str, Any]]:
    return [event for event in events if event.get("trace_id") == trace_id]


def _emit_from_args(args: argparse.Namespace) -> int:
    optional = {
        "parent_span_id": args.parent_span_id,
        "duration_ms": args.duration_ms,
        "exit_code": args.exit_code,
        "error_kind": args.error_kind,
        "command": args.command,
        "check_label": args.check_label,
        "status": args.status,
        "reason": args.reason,
        "count": args.count,
        "item_count": args.item_count,
        "pending_count": args.pending_count,
        "source": args.source,
        "source_event_type": args.source_event_type,
    }
    write_event(
        args.event_type,
        plane=args.plane,
        component=args.component,
        operation=args.operation,
        phase=args.phase,
        outcome=args.outcome,
        privacy=args.privacy,
        trace_id=args.trace_id,
        span_id=args.span_id,
        **optional,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="IMO observability event helper")
    subparsers = parser.add_subparsers(dest="action", required=True)
    subparsers.add_parser("trace-id")
    subparsers.add_parser("span-id")
    subparsers.add_parser("now-ms")

    emit = subparsers.add_parser("emit")
    emit.add_argument("--event-type", required=True, choices=sorted(EVENT_TYPES))
    emit.add_argument("--plane", required=True, choices=sorted(PLANES))
    emit.add_argument("--component", required=True)
    emit.add_argument("--operation", required=True)
    emit.add_argument("--phase", required=True, choices=sorted(PHASES))
    emit.add_argument("--outcome", default="ok", choices=sorted(OUTCOMES))
    emit.add_argument("--privacy", default="project_private", choices=sorted(PRIVACY_CLASSES))
    emit.add_argument("--trace-id")
    emit.add_argument("--span-id")
    emit.add_argument("--parent-span-id")
    emit.add_argument("--duration-ms", type=int)
    emit.add_argument("--exit-code", type=int)
    emit.add_argument("--error-kind")
    emit.add_argument("--command")
    emit.add_argument("--check-label")
    emit.add_argument("--status")
    emit.add_argument("--reason")
    emit.add_argument("--count", type=int)
    emit.add_argument("--item-count", type=int)
    emit.add_argument("--pending-count", type=int)
    emit.add_argument("--source")
    emit.add_argument("--source-event-type")

    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if args.action == "trace-id":
        print(new_trace_id())
        return 0
    if args.action == "span-id":
        print(new_span_id())
        return 0
    if args.action == "now-ms":
        print(now_ms())
        return 0
    if args.action == "emit":
        return _emit_from_args(args)
    return 64


if __name__ == "__main__":
    raise SystemExit(main())
