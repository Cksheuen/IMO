#!/usr/bin/env python3
"""Aggregate local metrics events into daily summaries."""

from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
METRICS_ROOT = CLAUDE_HOME / "metrics"
EVENTS_DIR = METRICS_ROOT / "events"
DAILY_DIR = METRICS_ROOT / "daily"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--daily", action="store_true", help="Generate a daily aggregate JSON")
    parser.add_argument("--date", dest="target_date", help="Target date in YYYY-MM-DD format")
    args = parser.parse_args()
    if not args.daily:
        parser.error("Phase 1 only supports --daily")
    return args


def resolve_date(raw: str | None) -> str:
    if raw:
        datetime.strptime(raw, "%Y-%m-%d")
        return raw
    return date.today().isoformat()


def load_events(target_date: str) -> list[dict[str, Any]]:
    path = EVENTS_DIR / f"{target_date}.jsonl"
    if not path.exists():
        return []

    events: list[dict[str, Any]] = []
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict):
                events.append(event)
    except OSError:
        return []
    return events


def round_metric(value: float) -> float:
    return round(value, 3)


def build_daily_summary(target_date: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    sessions = {str(event.get("session_id", "")).strip() for event in events if str(event.get("session_id", "")).strip()}
    by_hook_event = Counter()
    by_hook: dict[str, dict[str, Any]] = {}
    success_total = 0
    success_denominator = 0
    duration_values: list[int] = []

    for event in events:
        hook_id = str(event.get("hook_id") or "unknown")
        hook_event = str(event.get("hook_event") or "unknown")
        status = str(event.get("status") or "")
        duration = event.get("duration_ms")
        meta = event.get("meta")

        by_hook_event[hook_event] += 1
        stats = by_hook.setdefault(
            hook_id,
            {
                "run_count": 0,
                "success_count": 0,
                "error_count": 0,
                "allowed_count": 0,
                "blocked_count": 0,
                "avg_duration_ms": 0,
                "_durations": [],
                "_block_reasons": Counter(),
            },
        )
        stats["run_count"] += 1

        if status == "ok":
            stats["success_count"] += 1
            success_total += 1
            success_denominator += 1
        elif status == "error":
            stats["error_count"] += 1
            success_denominator += 1
        elif status == "allowed":
            stats["allowed_count"] += 1
        elif status == "blocked":
            stats["blocked_count"] += 1
            if isinstance(meta, dict):
                reason = str(meta.get("reason") or "").strip()
                if reason:
                    stats["_block_reasons"][reason] += 1
        elif status == "skipped":
            success_denominator += 0

        if isinstance(duration, (int, float)) and math.isfinite(duration):
            value = max(0, int(duration))
            stats["_durations"].append(value)
            duration_values.append(value)

    for hook_id, stats in by_hook.items():
        durations = stats.pop("_durations")
        if durations:
            stats["avg_duration_ms"] = round(sum(durations) / len(durations))
        block_reasons = stats.pop("_block_reasons")
        if block_reasons:
            stats["block_reasons"] = [
                {"reason": reason, "count": count}
                for reason, count in block_reasons.most_common()
            ]
        if not stats["allowed_count"]:
            stats.pop("allowed_count")
        if not stats["blocked_count"]:
            stats.pop("blocked_count")
        if not stats["success_count"]:
            stats.pop("success_count")
        if not stats["error_count"]:
            stats.pop("error_count")

    hook_runs = sum(1 for event in events if event.get("event") == "hook_run")
    gate_decisions = sum(1 for event in events if event.get("event") == "gate_decision")
    session_boundaries = sum(1 for event in events if event.get("event") == "session_boundary")

    summary = {
        "date": target_date,
        "summary": {
            "sessions": len(sessions),
            "total_events": len(events),
            "hook_runs": hook_runs,
            "gate_decisions": gate_decisions,
            "session_boundaries": session_boundaries,
            "overall_success_rate": round_metric(success_total / success_denominator) if success_denominator else None,
            "overall_avg_duration_ms": round(sum(duration_values) / len(duration_values)) if duration_values else None,
        },
        "by_hook": dict(sorted(by_hook.items())),
        "by_hook_event": dict(sorted(by_hook_event.items())),
    }
    return summary


def write_daily_summary(summary: dict[str, Any]) -> Path:
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    output = DAILY_DIR / f"{summary['date']}.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


def main() -> int:
    args = parse_args()
    target_date = resolve_date(args.target_date)
    summary = build_daily_summary(target_date, load_events(target_date))
    output = write_daily_summary(summary)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
