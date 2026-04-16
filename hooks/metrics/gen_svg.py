#!/usr/bin/env python3
"""Generate an SVG summary card from weekly metrics JSON for GitHub README."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
METRICS_ROOT = CLAUDE_HOME / "metrics"
WEEKLY_DIR = METRICS_ROOT / "weekly"
DASHBOARD_DIR = METRICS_ROOT / "dashboard"
I18N_DIR = METRICS_ROOT / "i18n"

# ── Layout constants ──
W = 860
CARD_H = 68
CARD_GAP = 10
BAR_MAX_W = 280
ROW_H = 28
TREND_BAR_W = 14
TREND_H = 60
COLORS = {
    "bg": "#0a0b09",
    "panel": "#12130f",
    "panel_2": "#181916",
    "panel_3": "#1e1f1b",
    "border": "#2e2d28",
    "border_subtle": "#222120",
    "text": "#f0ede6",
    "muted": "#8a8679",
    "gold": "#C9A962",
    "gold_dim": "#a08840",
    "green": "#22c55e",
    "yellow": "#f59e0b",
    "red": "#ef4444",
    "blue": "#3b82f6",
    "gray": "#4a4840",
    "bar_bg": "#222120",
}

EN_FALLBACK = {
    "svg.title": "METRICS WEEKLY",
    "svg.data_days": "data: {0}/7 days",
    "svg.card.sessions": "SESSIONS",
    "svg.card.events": "EVENTS",
    "svg.card.success_rate": "SUCCESS RATE",
    "svg.card.avg_duration": "AVG DURATION",
    "svg.section.daily_trend": "DAILY TREND",
    "svg.section.top_hooks": "TOP HOOKS",
    "svg.legend.sessions": "sessions",
    "svg.legend.events": "events/{0}",
    "svg.issue.failures": "{0} failures",
    "svg.issue.blocked": "{0}% blocked",
    "svg.label.total": "{0} total",
}
I18N = EN_FALLBACK.copy()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", dest="target_date", help="Target date YYYY-MM-DD")
    parser.add_argument("--lang", choices=["zh", "en"], default="zh", help="Language for SVG labels")
    return parser.parse_args()


def resolve_date(raw: str | None) -> str:
    if raw:
        return raw
    files = sorted(WEEKLY_DIR.glob("*.json"))
    if files:
        return files[-1].stem
    raise FileNotFoundError(f"No weekly JSON in {WEEKLY_DIR}")


def load(target_date: str) -> dict[str, Any]:
    return json.loads((WEEKLY_DIR / f"{target_date}.json").read_text("utf-8"))


def load_i18n(lang: str) -> dict[str, str]:
    path = I18N_DIR / f"{lang}.json"
    try:
        data = json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return EN_FALLBACK.copy()
    return {**EN_FALLBACK, **data}


def t(key: str, *args: Any) -> str:
    template = I18N.get(key, EN_FALLBACK.get(key, key))
    return template.format(*args)


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def fmt_pct(v: Any) -> str:
    if not isinstance(v, (int, float)):
        return "n/a"
    return f"{v * 100:.1f}%"


def success_color(v: Any) -> str:
    if not isinstance(v, (int, float)):
        return COLORS["gray"]
    if v > 0.95:
        return COLORS["green"]
    if v > 0.8:
        return COLORS["yellow"]
    return COLORS["red"]


def render_svg(data: dict[str, Any]) -> str:
    period = data.get("period", {})
    summary = data.get("summary", {})
    by_hook = data.get("by_hook", {})
    daily_trend = data.get("daily_trend", [])
    data_days = data.get("data_days", 0)

    hooks_sorted = sorted(by_hook.items(), key=lambda x: x[1].get("run_count", 0), reverse=True)
    top_hooks = hooks_sorted[:8]
    max_run = max((s.get("run_count", 0) for _, s in top_hooks), default=1) or 1

    rate = summary.get("overall_success_rate")
    rate_color = success_color(rate)
    avg_ms = summary.get("overall_avg_duration_ms")

    # ── Compute total height ──
    header_h = 50
    cards_y = header_h + 14
    cards_block_h = CARD_H
    trend_y = cards_y + cards_block_h + 26
    trend_label_h = 18
    trend_block_h = TREND_H + trend_label_h + 14
    hooks_y = trend_y + trend_block_h + 18
    hooks_header_h = 20
    hooks_block_h = hooks_header_h + len(top_hooks) * ROW_H + 10
    total_h = hooks_y + hooks_block_h + 18

    parts: list[str] = []

    # ── SVG open + styles ──
    parts.append(f"""\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {total_h}" width="{W}" height="{total_h}">
<style>
  @keyframes fadeIn {{ from {{ opacity: 0; }} to {{ opacity: 1; }} }}
  @keyframes growRight {{ from {{ width: 0; }} }}
  @keyframes slideUp {{ from {{ transform: translateY(8px); opacity: 0; }} to {{ transform: translateY(0); opacity: 1; }} }}
  .root {{ fill: {COLORS["bg"]}; }}
  .panel {{ fill: {COLORS["panel"]}; rx: 10; ry: 10; stroke: {COLORS["border_subtle"]}; stroke-width: 1; }}
  .t {{ fill: {COLORS["text"]}; font-family: "Martian Mono", "SF Mono", "Cascadia Code", Consolas, monospace; }}
  .t-title {{ font-size: 20px; font-weight: 700; letter-spacing: 0.08em; }}
  .t-sub {{ font-size: 10px; fill: {COLORS["muted"]}; }}
  .t-label {{ font-size: 10px; fill: {COLORS["muted"]}; text-transform: uppercase; letter-spacing: 0.06em; }}
  .t-value {{ font-size: 22px; font-weight: 700; }}
  .t-hook {{ font-size: 11px; }}
  .t-small {{ font-size: 10px; }}
  .t-section {{ font-size: 12px; font-weight: 600; fill: {COLORS["gold"]}; letter-spacing: 0.04em; }}
  .anim {{ animation: fadeIn 0.6s ease both; }}
  .bar-bg {{ fill: {COLORS["bar_bg"]}; rx: 4; ry: 4; }}
  .trend-dot {{ fill: {COLORS["gray"]}; }}
</style>
<rect class="root" width="{W}" height="{total_h}" rx="16" ry="16"/>
<rect x="0" y="0" width="{W}" height="2" fill="{COLORS["gold"]}"/>""")

    # ── Header ──
    parts.append(f"""\
<text x="24" y="32" class="t t-title anim" style="animation-delay:0.05s">{esc(t("svg.title"))}</text>
<text x="{W - 24}" y="24" class="t t-sub" text-anchor="end">{esc(period.get("start", ""))}&#160;~&#160;{esc(period.get("end", ""))}</text>
<text x="{W - 24}" y="40" class="t t-sub" text-anchor="end">{esc(t("svg.data_days", data_days))}</text>""")

    # ── Summary cards ──
    card_items = [
        (t("svg.card.sessions"), str(summary.get("sessions", 0)), COLORS["text"]),
        (t("svg.card.events"), str(summary.get("total_events", 0)), COLORS["text"]),
        (t("svg.card.success_rate"), fmt_pct(rate), rate_color),
        (t("svg.card.avg_duration"), f"{avg_ms} ms" if avg_ms is not None else "n/a", COLORS["text"]),
    ]
    card_w = (W - 24 * 2 - CARD_GAP * 3) / 4
    for i, (label, value, color) in enumerate(card_items):
        cx = 24 + i * (card_w + CARD_GAP)
        cy = cards_y
        parts.append(f'<rect class="panel" x="{cx}" y="{cy}" width="{card_w}" height="{CARD_H}"/>')
        parts.append(f'<text x="{cx + 14}" y="{cy + 20}" class="t t-label">{esc(label)}</text>')
        parts.append(f'<text x="{cx + 14}" y="{cy + 46}" class="t t-value" fill="{color}">{esc(value)}</text>')
        # progress bar for success rate
        if i == 2 and isinstance(rate, (int, float)):
            bar_y = cy + 54
            bar_w = card_w - 28
            fill_w = max(0, min(bar_w, bar_w * rate))
            parts.append(f'<rect class="bar-bg" x="{cx + 14}" y="{bar_y}" width="{bar_w}" height="5"/>')
            parts.append(f'<rect fill="{COLORS["gold_dim"] if color == COLORS["yellow"] else color}" rx="4" ry="4" x="{cx + 14}" y="{bar_y}" width="{fill_w}" height="5" style="animation: growRight 1s ease both;"/>')

    parts.append(f'<line x1="24" y1="{trend_y - 12}" x2="{W - 24}" y2="{trend_y - 12}" stroke="{COLORS["border"]}" stroke-width="1"/>')

    # ── Daily trend ──
    parts.append(f'<text x="24" y="{trend_y + 12}" class="t t-section">{esc(t("svg.section.daily_trend"))}</text>')
    if daily_trend:
        max_sessions = max((d.get("sessions", 0) for d in daily_trend), default=1) or 1
        max_events = max((d.get("total_events", 0) for d in daily_trend), default=1) or 1
        event_scale = max(1, round(max_events / max(1, max_sessions or 8)))
        norm_max = max(1, max(max(d.get("sessions", 0), d.get("total_events", 0) / event_scale) for d in daily_trend))

        chart_x = 24
        chart_y = trend_y + 22
        day_w = min(90, (W - 48) / max(1, len(daily_trend)))

        for j, day in enumerate(daily_trend):
            dx = chart_x + j * day_w
            sessions = day.get("sessions", 0)
            events = day.get("total_events", 0)
            date_str = (day.get("date") or "")[-5:]

            if sessions == 0 and events == 0:
                # empty dot
                parts.append(f'<circle class="trend-dot" cx="{dx + day_w / 2}" cy="{chart_y + TREND_H - 4}" r="3"/>')
            else:
                # session bar (blue)
                s_h = max(4, (sessions / norm_max) * TREND_H)
                s_y = chart_y + TREND_H - s_h
                parts.append(f'<rect fill="{COLORS["blue"]}" rx="3" ry="3" x="{dx + day_w / 2 - TREND_BAR_W - 2}" y="{s_y}" width="{TREND_BAR_W}" height="{s_h}" opacity="0.9" style="animation: slideUp 0.5s ease {0.1 * j}s both;"/>')
                # event bar (gold, scaled)
                e_val = events / event_scale
                e_h = max(4, (e_val / norm_max) * TREND_H)
                e_y = chart_y + TREND_H - e_h
                parts.append(f'<rect fill="{COLORS["gold_dim"]}" rx="3" ry="3" x="{dx + day_w / 2 + 2}" y="{e_y}" width="{TREND_BAR_W}" height="{e_h}" opacity="0.95" style="animation: slideUp 0.5s ease {0.1 * j + 0.05}s both;"/>')

            # date label
            parts.append(f'<text x="{dx + day_w / 2}" y="{chart_y + TREND_H + 12}" class="t t-sub" text-anchor="middle">{esc(date_str)}</text>')

        # legend
        legend_x = W - 24
        ly = trend_y + 12
        parts.append(f'<rect fill="{COLORS["blue"]}" rx="2" ry="2" x="{legend_x - 174}" y="{ly - 7}" width="8" height="8"/>')
        parts.append(f'<text x="{legend_x - 166}" y="{ly}" class="t t-sub">{esc(t("svg.legend.sessions"))}</text>')
        parts.append(f'<rect fill="{COLORS["gold_dim"]}" rx="2" ry="2" x="{legend_x - 96}" y="{ly - 7}" width="8" height="8"/>')
        parts.append(f'<text x="{legend_x - 84}" y="{ly}" class="t t-sub">{esc(t("svg.legend.events", event_scale))}</text>')

    parts.append(f'<line x1="24" y1="{hooks_y - 10}" x2="{W - 24}" y2="{hooks_y - 10}" stroke="{COLORS["border"]}" stroke-width="1"/>')

    # ── Hook usage bars ──
    parts.append(f'<text x="24" y="{hooks_y + 12}" class="t t-section">{esc(t("svg.section.top_hooks"))}</text>')
    parts.append(f'<text x="{W - 24}" y="{hooks_y + 12}" class="t t-sub" text-anchor="end">{esc(t("svg.label.total", len(by_hook)))}</text>')

    for idx, (hook_id, stats) in enumerate(top_hooks):
        ry = hooks_y + hooks_header_h + idx * ROW_H
        run_count = stats.get("run_count", 0)
        bar_w = max(4, (run_count / max_run) * BAR_MAX_W)
        blocked = stats.get("blocked_count", 0)
        block_rate = blocked / max(1, run_count)
        bar_color = COLORS["red"] if block_rate > 0.9 else COLORS["blue"]
        delay = f"{0.08 * idx}s"

        # hook name
        parts.append(f'<text x="24" y="{ry + 18}" class="t t-hook" style="animation: fadeIn 0.4s ease {delay} both;">{esc(hook_id)}</text>')
        # bar background
        parts.append(f'<rect class="bar-bg" x="240" y="{ry + 6}" width="{BAR_MAX_W}" height="12"/>')
        # bar fill
        parts.append(f'<rect fill="{COLORS["gold_dim"] if bar_color == COLORS["blue"] else bar_color}" rx="4" ry="4" x="240" y="{ry + 6}" width="{bar_w}" height="12" opacity="0.92" style="animation: growRight 0.8s ease {delay} both;"/>')
        # count
        parts.append(f'<text x="{240 + BAR_MAX_W + 10}" y="{ry + 18}" class="t t-small">{run_count}</text>')
        # active days
        active = stats.get("active_days", 0)
        parts.append(f'<text x="{240 + BAR_MAX_W + 48}" y="{ry + 18}" class="t t-sub">{active}d</text>')
        # blocked tag
        if blocked > 0:
            tag_x = 240 + BAR_MAX_W + 78
            parts.append(f'<rect fill="none" stroke="{COLORS["red"]}" stroke-width="1" rx="7" ry="7" x="{tag_x}" y="{ry + 4}" width="68" height="16"/>')
            parts.append(f'<text x="{tag_x + 34}" y="{ry + 16}" class="t t-small" text-anchor="middle" fill="{COLORS["red"]}">{block_rate * 100:.0f}% block</text>')

    # ── Issues summary line ──
    error_hooks = [(h, s) for h, s in hooks_sorted if s.get("error_count", 0) > 0]
    high_block = [(h, s) for h, s in hooks_sorted if s.get("blocked_count", 0) / max(1, s.get("run_count", 0)) > 0.9]

    if error_hooks or high_block:
        iy = total_h - 14
        issues_parts = []
        for h, s in error_hooks:
            issues_parts.append(f"{h}: {t('svg.issue.failures', s['error_count'])}")
        for h, s in high_block:
            br = s["blocked_count"] / max(1, s["run_count"])
            issues_parts.append(f"{h}: {t('svg.issue.blocked', f'{br * 100:.0f}')}")
        issues_text = " | ".join(issues_parts[:3])
        parts.append(f'<text x="{W / 2}" y="{iy}" class="t t-sub" text-anchor="middle" fill="{COLORS["yellow"]}">{esc(issues_text)}</text>')

    parts.append("</svg>")
    return "\n".join(parts)


def main() -> int:
    args = parse_args()
    global I18N
    I18N = load_i18n(args.lang)
    target_date = resolve_date(args.target_date)
    data = load(target_date)
    svg = render_svg(data)
    DASHBOARD_DIR.mkdir(parents=True, exist_ok=True)
    output = DASHBOARD_DIR / "preview.svg"
    output.write_text(svg, encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
