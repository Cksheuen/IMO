from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[4]
PYCACHE_PREFIX = Path(os.environ.get("PYTHONPYCACHEPREFIX", "/private/tmp/cc-codex-framework-pycache"))


def run_check(label: str, command: list[str], *, env: dict[str, str] | None = None) -> bool:
    print(f"[imo verify] {label}")
    result = subprocess.run(command, cwd=ROOT, env=env, check=False)
    if result.returncode == 0:
        print(f"[imo verify] ok: {label}")
        return True
    print(f"[imo verify] failed ({result.returncode}): {label}", file=sys.stderr)
    return False


def python_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONPYCACHEPREFIX"] = str(PYCACHE_PREFIX)
    return env


def no_event_env() -> dict[str, str]:
    env = python_env()
    env["IMO_DISABLE_LEARNING_EVENTS"] = "1"
    env["IMO_DISABLE_EVENTS"] = "1"
    return env
