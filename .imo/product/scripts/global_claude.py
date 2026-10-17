"""Claude Code paths and managed SessionStart script for the global installer."""
from __future__ import annotations

import os
from pathlib import Path
import shlex

HOOK_REL = Path("hooks/claude-context.sh")


def home(override: str | None = None) -> Path:
    return Path(override or os.environ.get("CLAUDE_HOME") or "~/.claude").expanduser().resolve()


def hook_text(source_root: Path) -> str:
    fallback = shlex.quote(str(source_root / "imo"))
    return f'''#!/usr/bin/env bash
set -euo pipefail
if command -v imo >/dev/null 2>&1; then
  exec imo codex context --event SessionStart
fi
if [[ -x {fallback} ]]; then
  exec {fallback} codex context --event SessionStart
fi
exit 0
'''


def surfaces(global_root: Path, claude_home: Path, source_root: Path) -> dict:
    return {
        "root": claude_home,
        "hook": global_root / HOOK_REL,
        "hook_rel": HOOK_REL,
        "text": hook_text(source_root),
        "settings": claude_home / "settings.json",
    }
