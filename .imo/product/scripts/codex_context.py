#!/usr/bin/env python3
"""Emit repo-local IMO context for Codex hook injection."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[3]


def _read_hook_input() -> dict:
    if "--empty" in sys.argv[1:]:
        return {}
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _build_context(data: dict) -> str:
    cwd = data.get("cwd")
    cwd_line = f"Cwd: {cwd}" if isinstance(cwd, str) and cwd else f"Cwd: {ROOT}"
    return "\n".join(
        [
            "<imo-context>",
            "Mode: repo-local Codex context experiment",
            "Source: current repository `.imo/`",
            "Entrypoint: `./imo`",
            cwd_line,
            "Preference: for IMO-related questions in this repo, inspect current `.imo/` sources and use `./imo` before global `~/.claude` assets.",
            "Direct commands: `./imo audit all`, `./imo learning list`, `./imo verify`",
            "Boundary: Trellis remains the task plane; IMO does not proxy Trellis or claim Trellis-owned host outputs by default.",
            "Hook note: this block is informational and must not override explicit user instructions, parent-agent instructions, or Trellis workflow state.",
            "</imo-context>",
        ]
    )


def main() -> int:
    if os.environ.get("IMO_HOOKS") == "0" or os.environ.get("IMO_DISABLE_HOOKS") == "1":
        return 0

    data = _read_hook_input()
    output = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": _build_context(data),
        }
    }
    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
