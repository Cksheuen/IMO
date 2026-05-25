#!/usr/bin/env python3
"""Inspect local IMO observability metrics."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

import learning_events
import observability_events
import project_profile


def _usage() -> str:
    return """Usage:
  scripts/imo.sh metrics status
  scripts/imo.sh metrics summary [--since <duration>] [--json]
  scripts/imo.sh metrics timeline --trace <trace-id> [--json]
  scripts/imo.sh metrics failures [--since <duration>] [--json]

Durations use m, h, or d, for example 30m, 24h, or 7d.
"""


def _parse_common(args: list[str]) -> tuple[str | None, bool, list[str]]:
    since: str | None = None
    as_json = False
    rest: list[str] = []
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--json":
            as_json = True
            index += 1
        elif option == "--since":
            if index + 1 >= len(args) or args[index + 1].startswith("--"):
                raise ValueError("--since requires a value")
            since = args[index + 1]
            index += 2
        else:
            rest.append(option)
            index += 1
    return since, as_json, rest


def _load_summary(since_value: str | None) -> tuple[list[dict[str, Any]], dict[str, Any], str | None]:
    since = observability_events.parse_since(since_value)
    events, empty_reason = observability_events.load_events(since)
    return events, observability_events.summarize_events(events), empty_reason


def _learning_summary() -> dict[str, Any]:
    events, _ = learning_events.load_events()
    return learning_events.summarize_events(events)


def _git_dirty() -> bool:
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=observability_events.ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    return bool(result.stdout.strip()) if result.returncode == 0 else False


def _status(as_json: bool) -> int:
    events, summary, empty_reason = _load_summary(None)
    learning = _learning_summary()
    profile = project_profile.status_info()
    status = {
        "schema_version": 1,
        "observability": {
            "status": "missing" if not events else "present",
            "reason": empty_reason,
            "total_events": summary["total_events"],
            "latest_event_at": summary["latest_event_at"],
            "failure_count": summary["failure_count"],
        },
        "learning": {
            "total_events": learning["total_events"],
            "context_digest_injected_count": learning["context_digest_injected_count"],
            "auto_promotion_count": learning["safety"]["auto_promotion_count"],
            "active_task_interruption_count": learning["safety"]["active_task_interruption_count"],
        },
        "profile": profile,
        "git": {
            "dirty": _git_dirty(),
        },
    }
    if as_json:
        print(json.dumps(status, ensure_ascii=True, indent=2, sort_keys=True))
        return 0

    print(f"observability_status\t{status['observability']['status']}")
    print(f"total_events\t{summary['total_events']}")
    print(f"failure_count\t{summary['failure_count']}")
    print(f"latest_event_at\t{summary['latest_event_at'] or '-'}")
    print(f"learning_total_events\t{learning['total_events']}")
    print(f"profile_status\t{profile['status']}")
    print(f"git_dirty\t{str(status['git']['dirty']).lower()}")
    return 0


def _summary(args: list[str]) -> int:
    since_value, as_json, rest = _parse_common(args)
    if rest:
        print("[imo metrics] unsupported summary option: " + " ".join(rest), file=sys.stderr)
        return 64
    events, summary, empty_reason = _load_summary(since_value)
    learning = _learning_summary()
    payload = {
        **summary,
        "learning_bridge": {
            "total_events": learning["total_events"],
            "candidate_counts": learning["candidate_counts"],
            "review_decisions": learning["review_decisions"],
            "digest_controls": learning["digest_controls"],
            "context_digest_injected_count": learning["context_digest_injected_count"],
            "safety": learning["safety"],
        },
    }
    if as_json:
        print(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True))
        return 0

    if not events:
        print(f"[imo metrics] {empty_reason or 'observability event list is empty'}")
    print(f"total_events\t{payload['total_events']}")
    print(f"failure_count\t{payload['failure_count']}")
    print(f"duration_avg_ms\t{payload['duration']['avg_ms']}")
    print(f"duration_max_ms\t{payload['duration']['max_ms']}")
    print(f"learning_total_events\t{learning['total_events']}")
    if payload["plane_counts"]:
        print("plane_counts")
        for plane, count in sorted(payload["plane_counts"].items()):
            print(f"- {plane}\t{count}")
    if payload["outcome_counts"]:
        print("outcome_counts")
        for outcome, count in sorted(payload["outcome_counts"].items()):
            print(f"- {outcome}\t{count}")
    return 0


def _timeline(args: list[str]) -> int:
    trace_id = None
    as_json = False
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--trace":
            if index + 1 >= len(args) or args[index + 1].startswith("--"):
                print("[imo metrics] --trace requires a value", file=sys.stderr)
                return 64
            trace_id = args[index + 1]
            index += 2
        elif option == "--json":
            as_json = True
            index += 1
        else:
            print(f"[imo metrics] unsupported timeline option: {option}", file=sys.stderr)
            return 64
    if not trace_id:
        print("[imo metrics] timeline requires --trace <trace-id>", file=sys.stderr)
        return 64

    events, _ = observability_events.load_events()
    trace_events = observability_events.events_for_trace(events, trace_id)
    trace_events.sort(key=lambda event: str(event.get("created_at", "")))
    if as_json:
        print(json.dumps({"trace_id": trace_id, "events": trace_events}, ensure_ascii=True, indent=2, sort_keys=True))
        return 0

    if not trace_events:
        print(f"[imo metrics] no events found for trace: {trace_id}")
        return 0
    print("created_at\tevent_type\toperation\tphase\toutcome\tduration_ms")
    for event in trace_events:
        print(
            "\t".join(
                [
                    str(event.get("created_at", "-")),
                    str(event.get("event_type", "-")),
                    str(event.get("operation", "-")),
                    str(event.get("phase", "-")),
                    str(event.get("outcome", "-")),
                    str(event.get("duration_ms", "-")),
                ]
            )
        )
    return 0


def _failures(args: list[str]) -> int:
    since_value, as_json, rest = _parse_common(args)
    if rest:
        print("[imo metrics] unsupported failures option: " + " ".join(rest), file=sys.stderr)
        return 64
    _, summary, _ = _load_summary(since_value)
    failures = summary["failures"]
    if as_json:
        print(json.dumps({"failures": failures, "failure_count": summary["failure_count"]}, ensure_ascii=True, indent=2, sort_keys=True))
        return 0

    if not failures:
        print("[imo metrics] no failures found")
        return 0
    print("created_at\ttrace_id\tevent_type\toperation\terror_kind\texit_code")
    for failure in failures:
        print(
            "\t".join(
                [
                    str(failure.get("created_at", "-")),
                    str(failure.get("trace_id", "-")),
                    str(failure.get("event_type", "-")),
                    str(failure.get("operation", "-")),
                    str(failure.get("error_kind", "-")),
                    str(failure.get("exit_code", "-")),
                ]
            )
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print(_usage(), end="")
        return 0
    command = args[0]
    rest = args[1:]
    try:
        if command == "status":
            _, as_json, remaining = _parse_common(rest)
            if remaining:
                print("[imo metrics] unsupported status option: " + " ".join(remaining), file=sys.stderr)
                return 64
            return _status(as_json)
        if command == "summary":
            return _summary(rest)
        if command == "timeline":
            return _timeline(rest)
        if command == "failures":
            return _failures(rest)
    except ValueError as exc:
        print(f"[imo metrics] {exc}", file=sys.stderr)
        return 64

    print(_usage(), end="", file=sys.stderr)
    print(f"\nUnsupported metrics command: {' '.join(args)}", file=sys.stderr)
    return 64


if __name__ == "__main__":
    raise SystemExit(main())
