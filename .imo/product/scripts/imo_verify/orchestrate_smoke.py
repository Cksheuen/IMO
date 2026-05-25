from __future__ import annotations

import sys

from .runner import python_env, run_check


def run_orchestrate_runtime_smoke() -> bool:
    return run_check(
        "orchestrate migrated runtime",
        [
            sys.executable,
            ".imo/product/skills/orchestrate/migrated/orchestrate/example.py",
            "--test",
        ],
        env=python_env(),
    )
