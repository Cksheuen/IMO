#!/usr/bin/env python3
"""Render the weekly metrics dashboard HTML from aggregated JSON."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
METRICS_ROOT = CLAUDE_HOME / "metrics"
WEEKLY_DIR = METRICS_ROOT / "weekly"
DASHBOARD_DIR = METRICS_ROOT / "dashboard"
TEMPLATE_PATH = DASHBOARD_DIR / "weekly.html"
OUTPUT_PATH = DASHBOARD_DIR / "weekly-rendered.html"
DATA_PATTERN = re.compile(r"/\*__DATA__\*/.*?/\*__DATA__\*/", re.DOTALL)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--weekly", action="store_true", help="Render the weekly dashboard")
    parser.add_argument("--date", dest="target_date", help="Target date in YYYY-MM-DD format")
    parser.add_argument("--open", action="store_true", dest="should_open", help="Open the rendered dashboard in the browser")
    return parser.parse_args()


def resolve_date(raw: str | None, source_dir: Path) -> str:
    if raw:
        return raw
    files = sorted(source_dir.glob("*.json"))
    if files:
        return files[-1].stem
    raise FileNotFoundError(f"No aggregate found in {source_dir}")


def load_weekly(target_date: str) -> dict[str, Any]:
    path = WEEKLY_DIR / f"{target_date}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def inject_data(template: str, payload: dict[str, Any]) -> str:
    replacement = f"/*__DATA__*/{json.dumps(payload, ensure_ascii=False)}/*__DATA__*/"
    rendered, count = DATA_PATTERN.subn(replacement, template, count=1)
    if count != 1:
        raise ValueError("Dashboard template is missing a unique /*__DATA__*/ placeholder")
    return rendered


def write_dashboard(html: str) -> Path:
    DASHBOARD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(html, encoding="utf-8")
    return OUTPUT_PATH


def open_dashboard(path: Path) -> None:
    subprocess.run(["open", str(path)], check=False)


def main() -> int:
    args = parse_args()
    target_date = resolve_date(args.target_date, WEEKLY_DIR)
    payload = load_weekly(target_date)
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    rendered = inject_data(template, payload)
    output = write_dashboard(rendered)

    if args.should_open:
        open_dashboard(output)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
