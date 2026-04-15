#!/usr/bin/env python3
"""Render a text daily report from aggregated metrics."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
METRICS_ROOT = CLAUDE_HOME / "metrics"
DAILY_DIR = METRICS_ROOT / "daily"
REPORTS_DIR = METRICS_ROOT / "reports"
SNAPSHOTS_DIR = REPORTS_DIR / "snapshots"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--daily", action="store_true", help="Render a daily report")
    parser.add_argument("--date", dest="target_date", help="Target date in YYYY-MM-DD format")
    args = parser.parse_args()
    if not args.daily:
        parser.error("Phase 1 only supports --daily")
    return args


def resolve_date(raw: str | None) -> str:
    if raw:
        return raw
    files = sorted(DAILY_DIR.glob("*.json"))
    if files:
        return files[-1].stem
    raise FileNotFoundError("No daily aggregate found")


def load_daily(target_date: str) -> dict[str, Any]:
    path = DAILY_DIR / f"{target_date}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def format_percent(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.1f}%"


def top_hooks(by_hook: dict[str, dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    return sorted(
        by_hook.items(),
        key=lambda item: (item[1].get("run_count", 0), item[1].get("avg_duration_ms", 0), item[0]),
        reverse=True,
    )[:5]


def failures(by_hook: dict[str, dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    items: list[tuple[str, dict[str, Any]]] = []
    for hook_id, stats in by_hook.items():
        error_count = stats.get("error_count", 0)
        if error_count:
            run_count = max(1, int(stats.get("run_count", 0)))
            items.append((hook_id, {"error_count": error_count, "failure_rate": error_count / run_count}))
    return sorted(items, key=lambda item: (item[1]["error_count"], item[1]["failure_rate"], item[0]), reverse=True)


def blocked_gates(by_hook: dict[str, dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    items: list[tuple[str, dict[str, Any]]] = []
    for hook_id, stats in by_hook.items():
        blocked = stats.get("blocked_count", 0)
        if blocked:
            items.append((hook_id, stats))
    return sorted(items, key=lambda item: (item[1].get("blocked_count", 0), item[0]), reverse=True)


def render_report(payload: dict[str, Any]) -> str:
    summary = payload.get("summary", {})
    by_hook = payload.get("by_hook", {})
    lines = [
        f"═══ CC/Codex 日报 {payload.get('date', '')} ═══",
        "",
        f"会话数: {summary.get('sessions', 0)}",
        f"事件总量: {summary.get('total_events', 0)}",
        f"Hook 成功率: {format_percent(summary.get('overall_success_rate'))}",
        f"平均耗时: {summary.get('overall_avg_duration_ms', 'n/a')}ms" if summary.get("overall_avg_duration_ms") is not None else "平均耗时: n/a",
        "",
        "── Top 5 Hook ──",
    ]

    top = top_hooks(by_hook)
    if top:
        for index, (hook_id, stats) in enumerate(top, start=1):
            avg = stats.get("avg_duration_ms", "n/a")
            lines.append(f" {index}. {hook_id:<24} {stats.get('run_count', 0)} 次  avg {avg}ms")
    else:
        lines.append(" 无事件")

    lines.extend(["", "── 失败 ──"])
    failures_list = failures(by_hook)
    if failures_list:
        for index, (hook_id, stats) in enumerate(failures_list, start=1):
            lines.append(
                f" {index}. {hook_id:<24} {stats['error_count']} 次失败 (failure_rate: {stats['failure_rate'] * 100:.1f}%)"
            )
    else:
        lines.append(" 无失败")

    lines.extend(["", "── Gate 阻断 ──"])
    blocked = blocked_gates(by_hook)
    if blocked:
        for index, (hook_id, stats) in enumerate(blocked, start=1):
            lines.append(f" {index}. {hook_id:<24} {stats.get('blocked_count', 0)} 次阻断")
            reasons = stats.get("block_reasons", [])
            if reasons:
                joined = ", ".join(f"\"{item['reason']}\": {item['count']}" for item in reasons[:3])
                lines.append(f"    {joined}")
    else:
        lines.append(" 无阻断")

    return "\n".join(lines).rstrip() + "\n"


def write_report(target_date: str, text: str) -> tuple[Path, Path]:
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    latest = REPORTS_DIR / "latest-daily.txt"
    snapshot = SNAPSHOTS_DIR / f"{target_date}.txt"
    latest.write_text(text, encoding="utf-8")
    snapshot.write_text(text, encoding="utf-8")
    return latest, snapshot


def main() -> int:
    args = parse_args()
    target_date = resolve_date(args.target_date)
    payload = load_daily(target_date)
    text = render_report(payload)
    write_report(target_date, text)
    print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
