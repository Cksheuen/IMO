#!/usr/bin/env python3
"""Fire-and-forget metrics emitter for Python hooks."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude")))
METRICS_DIR = CLAUDE_HOME / "metrics" / "events"


def emit_event(
    *,
    hook_id: str,
    hook_event: str,
    event: str = "hook_run",
    status: str = "ok",
    duration_ms: int | None = None,
    session_id: str | None = None,
    scope: str | None = None,
    source: str = "cc",
    cwd: str | None = None,
    meta: dict[str, Any] | list[Any] | None = None,
) -> None:
    """Append one event to today's JSONL ledger and swallow all failures."""
    try:
        METRICS_DIR.mkdir(parents=True, exist_ok=True)
        now = datetime.now().astimezone()
        date_str = now.strftime("%Y-%m-%d")
        record: dict[str, Any] = {
            "ts": now.isoformat(timespec="seconds"),
            "date": date_str,
            "session_id": session_id or os.environ.get("METRICS_SESSION_ID", "unknown"),
            "event": event,
            "hook_id": hook_id,
            "hook_event": hook_event,
            "status": status,
            "source": source,
            "scope": scope or os.environ.get("METRICS_SCOPE", "global"),
            "cwd": cwd or os.getcwd(),
        }
        if duration_ms is not None:
            record["duration_ms"] = max(0, int(duration_ms))
        if meta is not None:
            record["meta"] = meta

        output = METRICS_DIR / f"{date_str}.jsonl"
        with output.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        return
