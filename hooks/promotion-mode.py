#!/usr/bin/env python3
"""Shared entrypoint for Promotion Loop mode management."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


def main() -> None:
    target = Path.home() / ".claude" / ".claude" / "hooks" / "promotion-mode.py"
    if not target.is_file():
        raise SystemExit(f"Missing project hook entrypoint: {target}")

    sys.argv[0] = str(target)
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
