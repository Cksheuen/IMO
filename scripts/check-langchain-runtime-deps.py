#!/usr/bin/env python3
"""Compatibility wrapper for the canonical IMO runtime dependency checker."""

from __future__ import annotations

from pathlib import Path
import runpy


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / ".imo" / "product" / "scripts" / "check-langchain-runtime-deps.py"


if __name__ == "__main__":
    runpy.run_path(str(TARGET), run_name="__main__")
