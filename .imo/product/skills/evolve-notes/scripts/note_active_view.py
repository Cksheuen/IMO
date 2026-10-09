#!/usr/bin/env python3
"""Render active or struck content from an evolve-notes Markdown file."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
import sys


BOOKMARK_RE = re.compile(r"^\s*<!--\s*note:bookmark\s+[^>]*\bid=([a-z0-9][a-z0-9._-]*)\b[^>]*-->\s*$")
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")


@dataclass(frozen=True)
class StruckSegment:
    text: str
    start_line: int
    end_line: int


def fence_token(line: str) -> str | None:
    match = FENCE_RE.match(line)
    return match.group(1) if match else None


def bookmarks(lines: list[str]) -> list[tuple[str, int]]:
    result: list[tuple[str, int]] = []
    fence: str | None = None
    for index, line in enumerate(lines):
        token = fence_token(line)
        if fence:
            if token and token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if token:
            fence = token
            continue
        match = BOOKMARK_RE.match(line)
        if match:
            result.append((match.group(1), index))
    return result


def select_bookmark(lines: list[str], bookmark_id: str | None) -> tuple[list[str], int]:
    if not bookmark_id:
        return lines, 1
    found = bookmarks(lines)
    positions = [index for current_id, index in found if current_id == bookmark_id]
    if not positions:
        raise ValueError(f"bookmark not found: {bookmark_id}")
    if len(positions) > 1:
        raise ValueError(f"bookmark is duplicated: {bookmark_id}")
    start = positions[0]
    end = next((index for _, index in found if index > start), len(lines))
    return lines[start:end], start + 1


def matching_backticks(text: str, start: int) -> int | None:
    run = 1
    while start + run < len(text) and text[start + run] == "`":
        run += 1
    closing = text.find("`" * run, start + run)
    return closing + run if closing >= 0 else None


def render(lines: list[str], first_line: int) -> tuple[str, list[StruckSegment]]:
    active: list[str] = []
    struck: list[StruckSegment] = []
    struck_text: list[str] = []
    struck_start: int | None = None
    in_strike = False
    fence: str | None = None

    for offset, line in enumerate(lines):
        line_number = first_line + offset
        token = fence_token(line)
        if fence:
            active.append(line)
            if token and token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if token and not in_strike:
            fence = token
            active.append(line)
            continue

        index = 0
        while index < len(line):
            if line.startswith("~~", index):
                if in_strike:
                    struck.append(
                        StruckSegment(
                            text="".join(struck_text),
                            start_line=struck_start or line_number,
                            end_line=line_number,
                        )
                    )
                    struck_text = []
                    struck_start = None
                    in_strike = False
                else:
                    in_strike = True
                    struck_start = line_number
                index += 2
                continue

            if not in_strike and line[index] == "`":
                end = matching_backticks(line, index)
                if end is not None:
                    active.append(line[index:end])
                    index = end
                    continue

            if in_strike:
                struck_text.append(line[index])
            else:
                active.append(line[index])
            index += 1

    if in_strike:
        raise ValueError(f"unclosed strikethrough starting at line {struck_start}")
    return "".join(active), struck


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("note", type=Path)
    parser.add_argument("--bookmark", help="Limit output to one stable bookmark section.")
    parser.add_argument("--mode", choices=("active", "struck", "stats"), default="active")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable output.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        raw_lines = args.note.read_text(encoding="utf-8").splitlines(keepends=True)
        selected, first_line = select_bookmark(raw_lines, args.bookmark)
        active_text, struck = render(selected, first_line)
    except (OSError, ValueError) as exc:
        print(f"note_active_view: {exc}", file=sys.stderr)
        return 2

    stats = {
        "source_lines": len(selected),
        "source_chars": sum(len(line) for line in selected),
        "active_lines": len(active_text.splitlines()),
        "active_chars": len(active_text),
        "struck_segments": len(struck),
        "struck_chars": sum(len(segment.text) for segment in struck),
        "bookmark_count": len(bookmarks(selected)),
    }

    if args.json:
        print(
            json.dumps(
                {
                    "note": str(args.note),
                    "bookmark": args.bookmark,
                    "mode": args.mode,
                    "active_text": active_text if args.mode == "active" else None,
                    "struck_segments": [asdict(segment) for segment in struck],
                    "stats": stats,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    elif args.mode == "active":
        sys.stdout.write(active_text)
    elif args.mode == "struck":
        for segment in struck:
            print(f"L{segment.start_line}-L{segment.end_line}\t{segment.text.strip()}")
    else:
        for key, value in stats.items():
            print(f"{key}\t{value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
