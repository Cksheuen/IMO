#!/usr/bin/env python3
"""Render text daily / weekly reports from aggregated metrics."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
METRICS_ROOT = CLAUDE_HOME / "metrics"
DAILY_DIR = METRICS_ROOT / "daily"
WEEKLY_DIR = METRICS_ROOT / "weekly"
REPORTS_DIR = METRICS_ROOT / "reports"
SNAPSHOTS_DIR = REPORTS_DIR / "snapshots"
I18N_DIR = METRICS_ROOT / "i18n"

FALLBACK_ZH = {
    "report.daily.title": "═══ CC/Codex 日报 {0} ═══",
    "report.weekly.title": "═══ CC/Codex 周报 {0} ~ {1} ═══",
    "report.valid_data_days": "有效数据天数: {0}/7",
    "report.sessions": "会话数: {0}",
    "report.total_events": "事件总量: {0}",
    "report.success_rate": "Hook 成功率: {0}",
    "report.avg_duration": "平均耗时: {0}ms",
    "report.avg_duration_na": "平均耗时: n/a",
    "report.section.top_hooks": "Top 5 Hook",
    "report.section.failures": "失败",
    "report.section.gate_blocks": "Gate 阻断",
    "report.section.daily_trend": "每日趋势",
    "report.section.hook_usage": "Hook 使用统计",
    "report.section.failure_stats": "失败统计",
    "report.section.gate_block_stats": "Gate 阻断统计",
    "report.section.low_activity": "低活跃 Hook（活跃 ≤ 1 天）",
    "report.trend.sessions": "会话",
    "report.trend.events": "事件",
    "report.label.runs": "次",
    "report.label.active": "活跃",
    "report.label.days": "天",
    "report.label.daily_avg": "日均",
    "report.label.failures": "次失败",
    "report.label.blocks": "次阻断",
    "report.label.block_rate": "阻断率:",
    "report.empty.no_events": "无事件",
    "report.empty.no_failures": "无失败",
    "report.empty.no_blocks": "无阻断",
    "report.empty.all_active": "无（所有 Hook 均保持活跃）",
    "report.low_activity.item": "- {0:<28} 仅 {1} 天活跃，共 {2} 次",
}

I18N = FALLBACK_ZH.copy()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--daily", action="store_true", help="Render a daily report")
    mode.add_argument("--weekly", action="store_true", help="Render a weekly report")
    parser.add_argument("--date", dest="target_date", help="Target date in YYYY-MM-DD format")
    parser.add_argument("--lang", choices=("zh", "en"), default="zh", help="Report language")
    return parser.parse_args()


def resolve_date(raw: str | None, source_dir: Path) -> str:
    if raw:
        return raw
    files = sorted(source_dir.glob("*.json"))
    if files:
        return files[-1].stem
    raise FileNotFoundError(f"No aggregate found in {source_dir}")


def load_daily(target_date: str) -> dict[str, Any]:
    path = DAILY_DIR / f"{target_date}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_i18n(lang: str) -> dict[str, str]:
    path = I18N_DIR / f"{lang}.json"
    if not path.exists():
        return FALLBACK_ZH.copy()

    translations = FALLBACK_ZH.copy()
    loaded = json.loads(path.read_text(encoding="utf-8"))
    translations.update({key: str(value) for key, value in loaded.items()})
    return translations


def set_language(lang: str) -> None:
    global I18N
    I18N = load_i18n(lang)


def t(key: str, *args: Any) -> str:
    template = I18N.get(key, FALLBACK_ZH.get(key, key))
    return template.format(*args) if args else template


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


def format_avg_duration(value: Any) -> str:
    if value is None:
        return t("report.avg_duration_na")
    return t("report.avg_duration", value)


def render_daily_report(payload: dict[str, Any], lang: str) -> str:
    set_language(lang)
    summary = payload.get("summary", {})
    by_hook = payload.get("by_hook", {})
    lines = [
        t("report.daily.title", payload.get("date", "")),
        "",
        t("report.sessions", summary.get("sessions", 0)),
        t("report.total_events", summary.get("total_events", 0)),
        t("report.success_rate", format_percent(summary.get("overall_success_rate"))),
        format_avg_duration(summary.get("overall_avg_duration_ms")),
        "",
        f"── {t('report.section.top_hooks')} ──",
    ]

    top = top_hooks(by_hook)
    if top:
        for index, (hook_id, stats) in enumerate(top, start=1):
            avg = stats.get("avg_duration_ms", "n/a")
            lines.append(f" {index}. {hook_id:<24} {stats.get('run_count', 0)} {t('report.label.runs')}  avg {avg}ms")
    else:
        lines.append(f" {t('report.empty.no_events')}")

    lines.extend(["", f"── {t('report.section.failures')} ──"])
    failures_list = failures(by_hook)
    if failures_list:
        for index, (hook_id, stats) in enumerate(failures_list, start=1):
            lines.append(
                f" {index}. {hook_id:<24} {stats['error_count']} {t('report.label.failures')} (failure_rate: {stats['failure_rate'] * 100:.1f}%)"
            )
    else:
        lines.append(f" {t('report.empty.no_failures')}")

    lines.extend(["", f"── {t('report.section.gate_blocks')} ──"])
    blocked = blocked_gates(by_hook)
    if blocked:
        for index, (hook_id, stats) in enumerate(blocked, start=1):
            lines.append(f" {index}. {hook_id:<24} {stats.get('blocked_count', 0)} {t('report.label.blocks')}")
            reasons = stats.get("block_reasons", [])
            if reasons:
                joined = ", ".join(f"\"{item['reason']}\": {item['count']}" for item in reasons[:3])
                lines.append(f"    {joined}")
    else:
        lines.append(f" {t('report.empty.no_blocks')}")

    return "\n".join(lines).rstrip() + "\n"


def render_weekly_report(payload: dict[str, Any], lang: str) -> str:
    set_language(lang)
    period = payload.get("period", {})
    summary = payload.get("summary", {})
    by_hook = payload.get("by_hook", {})
    daily_trend = payload.get("daily_trend", [])
    data_days = payload.get("data_days", 0)

    lines = [
        t("report.weekly.title", period.get("start", ""), period.get("end", "")),
        "",
        t("report.valid_data_days", data_days),
        t("report.sessions", summary.get("sessions", 0)),
        t("report.total_events", summary.get("total_events", 0)),
        t("report.success_rate", format_percent(summary.get("overall_success_rate"))),
        format_avg_duration(summary.get("overall_avg_duration_ms")),
    ]

    # -- daily trend --
    lines.extend(["", f"── {t('report.section.daily_trend')} ──"])
    for day in daily_trend:
        d = day["date"]
        s = day["sessions"]
        e = day["total_events"]
        bar = "█" * min(s, 30) if s else "·"
        lines.append(f" {d}  {t('report.trend.sessions')} {s:>2}  {t('report.trend.events')} {e:>4}  {bar}")

    # -- all hooks ranked --
    lines.extend(["", f"── {t('report.section.hook_usage')} ──"])
    ranked = sorted(by_hook.items(), key=lambda item: item[1].get("run_count", 0), reverse=True)
    for index, (hook_id, stats) in enumerate(ranked, start=1):
        run = stats.get("run_count", 0)
        active = stats.get("active_days", 0)
        avg_daily = stats.get("avg_daily_runs", 0)
        avg_dur = stats.get("avg_duration_ms", 0)
        lines.append(
            f" {index:>2}. {hook_id:<28} {run:>4} {t('report.label.runs')}  "
            f"{t('report.label.active')} {active} {t('report.label.days')}  "
            f"{t('report.label.daily_avg')} {avg_daily:.1f} {t('report.label.runs')}  avg {avg_dur}ms"
        )

    # -- failures --
    lines.extend(["", f"── {t('report.section.failure_stats')} ──"])
    failures_list = failures(by_hook)
    if failures_list:
        for index, (hook_id, stats) in enumerate(failures_list, start=1):
            lines.append(
                f" {index}. {hook_id:<28} {stats['error_count']} {t('report.label.failures')} "
                f"(failure_rate: {stats['failure_rate'] * 100:.1f}%)"
            )
    else:
        lines.append(f" {t('report.empty.no_failures')}")

    # -- gate blocks --
    lines.extend(["", f"── {t('report.section.gate_block_stats')} ──"])
    blocked = blocked_gates(by_hook)
    if blocked:
        for index, (hook_id, stats) in enumerate(blocked, start=1):
            blocked_count = stats.get("blocked_count", 0)
            run_count = max(1, stats.get("run_count", 0))
            block_rate = blocked_count / run_count * 100
            lines.append(
                f" {index}. {hook_id:<28} {blocked_count} {t('report.label.blocks')} "
                f"({t('report.label.block_rate')} {block_rate:.1f}%)"
            )
            reasons = stats.get("block_reasons", [])
            if reasons:
                joined = ", ".join(f"\"{item['reason']}\": {item['count']}" for item in reasons[:5])
                lines.append(f"    {joined}")
    else:
        lines.append(f" {t('report.empty.no_blocks')}")

    # -- low-activity hooks --
    lines.extend(["", f"── {t('report.section.low_activity')} ──"])
    low_activity = [(hid, s) for hid, s in ranked if s.get("active_days", 0) <= 1 and data_days > 1]
    if low_activity:
        for hook_id, stats in low_activity:
            lines.append(
                t(
                    "report.low_activity.item",
                    hook_id,
                    stats.get("active_days", 0),
                    stats.get("run_count", 0),
                )
            )
    else:
        lines.append(f" {t('report.empty.all_active')}")

    return "\n".join(lines).rstrip() + "\n"


def write_report(target_date: str, text: str, kind: str = "daily") -> tuple[Path, Path]:
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    latest = REPORTS_DIR / f"latest-{kind}.txt"
    snapshot = SNAPSHOTS_DIR / f"{kind}-{target_date}.txt"
    latest.write_text(text, encoding="utf-8")
    snapshot.write_text(text, encoding="utf-8")
    return latest, snapshot


def main() -> int:
    args = parse_args()

    if args.daily:
        target_date = resolve_date(args.target_date, DAILY_DIR)
        payload = load_daily(target_date)
        text = render_daily_report(payload, args.lang)
        write_report(target_date, text, "daily")
    else:
        target_date = resolve_date(args.target_date, WEEKLY_DIR)
        path = WEEKLY_DIR / f"{target_date}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        text = render_weekly_report(payload, args.lang)
        write_report(target_date, text, "weekly")

    print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
