#!/usr/bin/env python3
"""Validate host-output policy docs against current coexistence decisions."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[3]
ADAPTERS_ROOT = ROOT / ".imo" / "adapters"

REQUIRED_PHRASES = {
    ROOT / ".imo" / "adapters" / "HOST_OUTPUT_CUTOVER.md": [
        "The current direction is coexistence, not same-path takeover.",
        "Trellis Update Merge Runbook",
        "Future IMO adapter projections may target host files only when the path is",
        "clearly outside Trellis ownership.",
    ],
    ROOT / ".imo" / "ROADMAP.md": [
        "### Host Output Direction",
        "Same-path host-output takeover is abandoned.",
        "Future IMO host outputs must use namespaced non-overlapping paths",
    ],
}

BANNED_PATTERNS = [
    (re.compile(r"upstream-first", re.IGNORECASE), "old upstream-first handoff strategy"),
    (re.compile(r"\bWave\s+[123]\b", re.IGNORECASE), "old numbered wave plan"),
    (re.compile(r"planned host-output cutover", re.IGNORECASE), "old planned cutover roadmap"),
    (re.compile(r"ownership handoff", re.IGNORECASE), "old ownership handoff framing"),
    (re.compile(r"simulate handoff", re.IGNORECASE), "old handoff wording"),
    (re.compile(r"host-output cutover is blocked", re.IGNORECASE), "old blocked cutover status"),
]


def _relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def _line_number(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def _policy_files() -> Iterable[Path]:
    yield ROOT / ".imo" / "ROADMAP.md"
    if ADAPTERS_ROOT.is_dir():
        yield from sorted(ADAPTERS_ROOT.rglob("*.md"))


def main() -> int:
    errors: list[str] = []

    for path in _policy_files():
        if not path.is_file():
            errors.append(f"{_relative(path)}: missing policy file")
            continue
        text = path.read_text(encoding="utf-8")
        for pattern, reason in BANNED_PATTERNS:
            match = pattern.search(text)
            if match:
                errors.append(
                    f"{_relative(path)}:{_line_number(text, match.start())}: {reason}: {match.group(0)!r}"
                )

    for path, phrases in REQUIRED_PHRASES.items():
        if not path.is_file():
            errors.append(f"{_relative(path)}: missing policy file")
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in phrases:
            if phrase not in text:
                errors.append(f"{_relative(path)}: missing required phrase {phrase!r}")

    if errors:
        print("[host output policy] failed")
        for error in errors:
            print(f"- {error}")
        return 1

    print("[host output policy] ok: coexistence policy docs match current host boundary")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
