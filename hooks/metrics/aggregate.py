#!/usr/bin/env python3
"""Aggregate local metrics events into daily / weekly summaries."""

from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
METRICS_ROOT = CLAUDE_HOME / "metrics"
EVENTS_DIR = METRICS_ROOT / "events"
DAILY_DIR = METRICS_ROOT / "daily"
WEEKLY_DIR = METRICS_ROOT / "weekly"
ASSET_DESCRIPTIONS_PATH = METRICS_ROOT / "asset-descriptions.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--daily", action="store_true", help="Generate a daily aggregate JSON")
    mode.add_argument("--weekly", action="store_true", help="Generate a weekly aggregate JSON")
    parser.add_argument("--date", dest="target_date", help="Target date in YYYY-MM-DD format (end date for weekly)")
    return parser.parse_args()


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


def load_events_range(start_date: str, end_date: str) -> list[dict[str, Any]]:
    """Load events from all JSONL files in [start_date, end_date]."""
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    all_events: list[dict[str, Any]] = []
    current = start
    while current <= end:
        all_events.extend(load_events(current.isoformat()))
        current += timedelta(days=1)
    return all_events


def load_asset_descriptions() -> dict[str, dict[str, dict[str, Any]]]:
    if not ASSET_DESCRIPTIONS_PATH.exists():
        return {"hooks": {}, "skills": {}, "rules": {}}

    try:
        payload = json.loads(ASSET_DESCRIPTIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"hooks": {}, "skills": {}, "rules": {}}

    if not isinstance(payload, dict):
        return {"hooks": {}, "skills": {}, "rules": {}}

    result: dict[str, dict[str, dict[str, Any]]] = {"hooks": {}, "skills": {}, "rules": {}}
    for group in result:
        entries = payload.get(group)
        if isinstance(entries, dict):
            result[group] = {
                str(key): value
                for key, value in entries.items()
                if isinstance(key, str) and isinstance(value, dict)
            }
    return result


def round_metric(value: float) -> float:
    return round(value, 3)


def build_daily_summary(
    target_date: str,
    events: list[dict[str, Any]],
    asset_descriptions: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any]:
    sessions = {str(event.get("session_id", "")).strip() for event in events if str(event.get("session_id", "")).strip()}
    by_hook_event = Counter()
    by_rule = Counter()
    by_skill = Counter()
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

        if hook_id == "rules-inject" and isinstance(meta, dict):
            for rule_path in meta.get("injected_rules", []):
                if isinstance(rule_path, str) and rule_path:
                    by_rule[rule_path] += 1
        if hook_id == "skill-inject" and isinstance(meta, dict):
            for skill_name in meta.get("matched_skills", []):
                if isinstance(skill_name, str) and skill_name:
                    by_skill[skill_name] += 1

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
        hook_meta = asset_descriptions["hooks"].get(hook_id, {})
        stats["description_zh"] = str(hook_meta.get("description_zh") or "")
        stats["description_en"] = str(hook_meta.get("description_en") or "")

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
        "by_rule": {
            path: {
                "inject_count": count,
                "title": str(asset_descriptions["rules"].get(path, {}).get("title") or ""),
            }
            for path, count in sorted(by_rule.items())
        },
        "by_skill": {
            name: {
                "match_count": count,
                "description_zh": str(asset_descriptions["skills"].get(name, {}).get("description_zh") or ""),
                "description_en": str(asset_descriptions["skills"].get(name, {}).get("description_en") or ""),
            }
            for name, count in sorted(by_skill.items())
        },
    }
    return summary


def build_weekly_summary(
    end_date: str,
    events: list[dict[str, Any]],
    dates_with_data: list[str],
    asset_descriptions: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any]:
    """Build a weekly aggregate from multi-day events, including per-day breakdown and trend."""
    end_d = datetime.strptime(end_date, "%Y-%m-%d").date()
    start_d = end_d - timedelta(days=6)
    start_date = start_d.isoformat()

    sessions = {str(e.get("session_id", "")).strip() for e in events if str(e.get("session_id", "")).strip()}
    by_hook_event = Counter()
    by_rule: dict[str, dict[str, Any]] = {}
    by_skill: dict[str, dict[str, Any]] = {}
    by_hook: dict[str, dict[str, Any]] = {}
    success_total = 0
    success_denominator = 0
    duration_values: list[int] = []

    # per-day counters for trend
    per_day: dict[str, dict[str, Any]] = {}
    for i in range(7):
        d = (start_d + timedelta(days=i)).isoformat()
        per_day[d] = {"sessions": set(), "total_events": 0, "hook_runs": 0, "gate_decisions": 0}

    for event in events:
        hook_id = str(event.get("hook_id") or "unknown")
        hook_event = str(event.get("hook_event") or "unknown")
        status = str(event.get("status") or "")
        duration = event.get("duration_ms")
        meta = event.get("meta")
        event_date = str(event.get("date") or "")

        by_hook_event[hook_event] += 1

        # per-day tracking
        if event_date in per_day:
            per_day[event_date]["total_events"] += 1
            sid = str(event.get("session_id", "")).strip()
            if sid:
                per_day[event_date]["sessions"].add(sid)
            if event.get("event") == "hook_run":
                per_day[event_date]["hook_runs"] += 1
            elif event.get("event") == "gate_decision":
                per_day[event_date]["gate_decisions"] += 1

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
                "_active_days": set(),
            },
        )
        stats["run_count"] += 1
        if event_date:
            stats["_active_days"].add(event_date)

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

        if isinstance(duration, (int, float)) and math.isfinite(duration):
            value = max(0, int(duration))
            stats["_durations"].append(value)
            duration_values.append(value)

        if hook_id == "rules-inject" and isinstance(meta, dict):
            for rule_path in meta.get("injected_rules", []):
                if isinstance(rule_path, str) and rule_path:
                    entry = by_rule.setdefault(rule_path, {"inject_count": 0, "_active_days": set()})
                    entry["inject_count"] += 1
                    if event_date:
                        entry["_active_days"].add(event_date)
        if hook_id == "skill-inject" and isinstance(meta, dict):
            for skill_name in meta.get("matched_skills", []):
                if isinstance(skill_name, str) and skill_name:
                    entry = by_skill.setdefault(skill_name, {"match_count": 0, "_active_days": set()})
                    entry["match_count"] += 1
                    if event_date:
                        entry["_active_days"].add(event_date)

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
        active_days = stats.pop("_active_days")
        stats["active_days"] = len(active_days)
        stats["avg_daily_runs"] = round_metric(stats["run_count"] / max(1, len(active_days)))
        if not stats["allowed_count"]:
            stats.pop("allowed_count")
        if not stats["blocked_count"]:
            stats.pop("blocked_count")
        if not stats["success_count"]:
            stats.pop("success_count")
        if not stats["error_count"]:
            stats.pop("error_count")
        hook_meta = asset_descriptions["hooks"].get(hook_id, {})
        stats["description_zh"] = str(hook_meta.get("description_zh") or "")
        stats["description_en"] = str(hook_meta.get("description_en") or "")

    for path, entry in by_rule.items():
        active = entry.pop("_active_days")
        entry["active_days"] = len(active)
        entry["title"] = str(asset_descriptions["rules"].get(path, {}).get("title") or "")
    for name, entry in by_skill.items():
        active = entry.pop("_active_days")
        entry["active_days"] = len(active)
        skill_meta = asset_descriptions["skills"].get(name, {})
        entry["description_zh"] = str(skill_meta.get("description_zh") or "")
        entry["description_en"] = str(skill_meta.get("description_en") or "")

    hook_runs = sum(1 for e in events if e.get("event") == "hook_run")
    gate_decisions = sum(1 for e in events if e.get("event") == "gate_decision")
    session_boundaries = sum(1 for e in events if e.get("event") == "session_boundary")

    # finalize per-day (convert sets to counts)
    daily_trend = []
    for d in sorted(per_day.keys()):
        info = per_day[d]
        daily_trend.append({
            "date": d,
            "sessions": len(info["sessions"]),
            "total_events": info["total_events"],
            "hook_runs": info["hook_runs"],
            "gate_decisions": info["gate_decisions"],
        })

    return {
        "period": {"start": start_date, "end": end_date},
        "data_days": len(dates_with_data),
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
        "by_rule": dict(sorted(by_rule.items())),
        "by_skill": dict(sorted(by_skill.items())),
        "daily_trend": daily_trend,
    }


def write_daily_summary(summary: dict[str, Any]) -> Path:
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    output = DAILY_DIR / f"{summary['date']}.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


def write_weekly_summary(summary: dict[str, Any]) -> Path:
    WEEKLY_DIR.mkdir(parents=True, exist_ok=True)
    end_date = summary["period"]["end"]
    output = WEEKLY_DIR / f"{end_date}.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


def main() -> int:
    args = parse_args()
    target_date = resolve_date(args.target_date)
    asset_descriptions = load_asset_descriptions()

    if args.daily:
        summary = build_daily_summary(target_date, load_events(target_date), asset_descriptions)
        output = write_daily_summary(summary)
    else:
        end_d = datetime.strptime(target_date, "%Y-%m-%d").date()
        start_d = end_d - timedelta(days=6)
        events = load_events_range(start_d.isoformat(), target_date)
        dates_with_data = [
            (start_d + timedelta(days=i)).isoformat()
            for i in range(7)
            if (EVENTS_DIR / f"{(start_d + timedelta(days=i)).isoformat()}.jsonl").exists()
        ]
        summary = build_weekly_summary(target_date, events, dates_with_data, asset_descriptions)
        output = write_weekly_summary(summary)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
