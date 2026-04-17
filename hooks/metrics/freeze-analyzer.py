#!/usr/bin/env python3
"""Weekly freeze candidate analyzer.

Scans local metrics/events for the last N days, identifies skills that
never got matched by the skill-inject hook, and emits a per-host candidate
report. Does NOT move or modify any skill files — Phase 1 is observation only.

Outputs (per host, not tracked by git):
  metrics/.freeze-candidates-<hostname>-<iso_week>.json
  metrics/reports/freeze-<hostname>-<iso_week>.md

Usage:
  python3 freeze-analyzer.py            # run with defaults (14-day window)
  python3 freeze-analyzer.py --days 21  # widen window
  python3 freeze-analyzer.py --dry-run  # print summary only
"""

from __future__ import annotations

import argparse
import json
import os
import socket
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
SKILLS_DIR = CLAUDE_HOME / "skills"
EVENTS_DIR = CLAUDE_HOME / "metrics" / "events"
METRICS_DIR = CLAUDE_HOME / "metrics"
REPORTS_DIR = METRICS_DIR / "reports"

# Skills directories excluded from freeze analysis:
# - vendor/: upstream-mirrored read-only packs managed by vendor-sync
# - migrated/: staging area for moved legacy content
SKILL_EXCLUDE = {"vendor", "migrated"}

# Minimum session count in window required for a reliable verdict.
# If the machine was mostly idle, we do not trust zero-match signals.
MIN_SESSIONS_FOR_VERDICT = 3


def discover_skills() -> list[str]:
    """Return the set of top-level skill directory names (excluding vendor/migrated)."""
    if not SKILLS_DIR.is_dir():
        return []
    names = []
    for entry in SKILLS_DIR.iterdir():
        if not entry.is_dir():
            continue
        if entry.name in SKILL_EXCLUDE:
            continue
        if entry.name.startswith("."):
            continue
        if not (entry / "SKILL.md").is_file():
            continue
        names.append(entry.name)
    return sorted(names)


def load_events(days: int) -> tuple[Counter[str], set[str], int]:
    """Scan events in the last `days` days.

    Returns:
        match_counts: skill_name -> matched_skills event count
        session_ids: distinct session ids observed in window
        file_count: number of jsonl files scanned
    """
    match_counts: Counter[str] = Counter()
    session_ids: set[str] = set()
    if not EVENTS_DIR.is_dir():
        return match_counts, session_ids, 0

    today = datetime.now().date()
    cutoff = today - timedelta(days=days - 1)

    file_count = 0
    for f in sorted(EVENTS_DIR.glob("*.jsonl")):
        try:
            file_date = datetime.strptime(f.stem, "%Y-%m-%d").date()
        except ValueError:
            continue
        if file_date < cutoff:
            continue
        file_count += 1
        with f.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                sid = rec.get("session_id")
                if isinstance(sid, str) and sid:
                    session_ids.add(sid)
                if rec.get("hook_id") != "skill-inject":
                    continue
                meta = rec.get("meta")
                if not isinstance(meta, dict):
                    continue
                matched = meta.get("matched_skills", [])
                if not isinstance(matched, list):
                    continue
                for name in matched:
                    if isinstance(name, str) and name:
                        match_counts[name] += 1

    return match_counts, session_ids, file_count


def iso_week_id(d: datetime | None = None) -> str:
    d = d or datetime.now()
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def build_report(
    hostname: str,
    window_days: int,
    skills_all: list[str],
    match_counts: Counter[str],
    session_ids: set[str],
    file_count: int,
) -> tuple[dict[str, Any], str]:
    """Return (json_payload, markdown_report)."""
    session_count = len(session_ids)
    active_enough = session_count >= MIN_SESSIONS_FOR_VERDICT

    # Split into three buckets:
    # - zero_match: skills never touched by skill-inject in window
    # - cold: matched < 3 times (soft signal, still low)
    # - warm: matched >= 3 times
    zero_match = [s for s in skills_all if match_counts.get(s, 0) == 0]
    cold = [(s, match_counts[s]) for s in skills_all if 0 < match_counts.get(s, 0) < 3]
    warm = [(s, match_counts[s]) for s in skills_all if match_counts.get(s, 0) >= 3]

    week_id = iso_week_id()
    payload = {
        "hostname": hostname,
        "iso_week": week_id,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "window_days": window_days,
        "window_session_count": session_count,
        "window_event_files_scanned": file_count,
        "active_enough_for_verdict": active_enough,
        "min_sessions_required": MIN_SESSIONS_FOR_VERDICT,
        "skills_total": len(skills_all),
        "skills_zero_match": zero_match,
        "skills_cold": [{"name": n, "match_count": c} for n, c in cold],
        "skills_warm": [{"name": n, "match_count": c} for n, c in warm],
        "phase": "observation",
        "action_taken": "none",
    }

    # Markdown report
    lines = [
        f"# Freeze Candidate Report — {hostname} / {week_id}",
        "",
        f"- Generated: {payload['generated_at']}",
        f"- Window: last {window_days} days",
        f"- Sessions observed: {session_count}",
        f"- Event files scanned: {file_count}",
        f"- Skills total (excluding vendor/migrated): {len(skills_all)}",
        "",
    ]
    if not active_enough:
        lines += [
            f"> ⚠️ Only {session_count} session(s) in window (< {MIN_SESSIONS_FOR_VERDICT} required).",
            "> Verdict deferred — zero-match does not imply low utility when activity is sparse.",
            "",
        ]

    lines += [
        f"## Zero-match skills ({len(zero_match)})",
        "Skills that were never matched by `skill-inject` in this window.",
        "",
    ]
    if zero_match:
        for s in zero_match:
            lines.append(f"- `{s}`")
    else:
        lines.append("_(none)_")
    lines.append("")

    lines += [
        f"## Cold skills — matched 1–2 times ({len(cold)})",
        "",
    ]
    if cold:
        for n, c in cold:
            lines.append(f"- `{n}` — {c}")
    else:
        lines.append("_(none)_")
    lines.append("")

    lines += [
        f"## Warm skills — matched ≥3 times ({len(warm)})",
        "",
    ]
    if warm:
        for n, c in warm:
            lines.append(f"- `{n}` — {c}")
    else:
        lines.append("_(none)_")
    lines.append("")

    lines += [
        "## Next step",
        "",
        "Phase 1 is observation-only. No skills are moved or disabled.",
        "Review this report and, if you agree with the zero-match bucket,",
        "run `/freeze-apply` (to be implemented in Phase 2) to register a",
        "per-host soft freeze via `metrics/.local-frozen-<hostname>.json`.",
        "",
    ]

    return payload, "\n".join(lines)


def write_outputs(payload: dict[str, Any], markdown: str) -> tuple[Path, Path]:
    hostname = payload["hostname"]
    week = payload["iso_week"]
    METRICS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    json_path = METRICS_DIR / f".freeze-candidates-{hostname}-{week}.json"
    md_path = REPORTS_DIR / f"freeze-{hostname}-{week}.md"

    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md_path.write_text(markdown, encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--days",
        type=int,
        default=14,
        help="Lookback window in days (default: 14)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print summary without writing files",
    )
    args = parser.parse_args()

    hostname = socket.gethostname()
    skills_all = discover_skills()
    if not skills_all:
        print(f"No skills found under {SKILLS_DIR}")
        return 1

    match_counts, session_ids, file_count = load_events(args.days)
    payload, markdown = build_report(
        hostname=hostname,
        window_days=args.days,
        skills_all=skills_all,
        match_counts=match_counts,
        session_ids=session_ids,
        file_count=file_count,
    )

    summary = (
        f"[freeze-analyzer] host={hostname} week={payload['iso_week']} "
        f"skills={payload['skills_total']} "
        f"zero_match={len(payload['skills_zero_match'])} "
        f"cold={len(payload['skills_cold'])} warm={len(payload['skills_warm'])} "
        f"sessions={payload['window_session_count']} "
        f"active_enough={payload['active_enough_for_verdict']}"
    )

    if args.dry_run:
        print(summary)
        return 0

    json_path, md_path = write_outputs(payload, markdown)
    print(summary)
    print(f"json: {json_path}")
    print(f"md:   {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
