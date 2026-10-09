#!/usr/bin/env python3
"""List, show, index, and validate stable bookmarks in evolve-notes Markdown."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
import sys


BOOKMARK_RE = re.compile(r"^\s*<!--\s*note:bookmark\s+(?P<attrs>[^>]*)-->\s*$")
ATTR_RE = re.compile(r"([A-Za-z][A-Za-z0-9_-]*)=(\"[^\"]*\"|[^\s]+)")
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
INDEX_ITEM_RE = re.compile(r"^\s*-\s+`([^`]+)`")
VALID_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


@dataclass(frozen=True)
class Bookmark:
    id: str
    title: str
    line: int
    index: int


@dataclass(frozen=True)
class LocatedBookmark:
    note: str
    id: str
    title: str
    line: int
    index: int


def fence_token(line: str) -> str | None:
    match = FENCE_RE.match(line)
    return match.group(1) if match else None


def parse_bookmarks(lines: list[str]) -> tuple[list[Bookmark], list[str]]:
    result: list[Bookmark] = []
    errors: list[str] = []
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
        if not match:
            continue
        attrs = {
            key: value[1:-1] if value.startswith('"') and value.endswith('"') else value
            for key, value in ATTR_RE.findall(match.group("attrs"))
        }
        bookmark_id = attrs.get("id", "")
        if not bookmark_id:
            errors.append(f"line {index + 1}: bookmark is missing id")
            continue
        result.append(
            Bookmark(
                id=bookmark_id,
                title=attrs.get("title", ""),
                line=index + 1,
                index=index,
            )
        )
    return result, errors


def indexed_ids(lines: list[str]) -> list[str] | None:
    start: int | None = None
    for index, line in enumerate(lines):
        if line.strip() == "## 书签索引":
            start = index + 1
            break
    if start is None:
        return None
    result: list[str] = []
    for line in lines[start:]:
        if BOOKMARK_RE.match(line) or (line.startswith("## ") and result):
            break
        match = INDEX_ITEM_RE.match(line)
        if match:
            result.append(match.group(1))
    return result


def validate(lines: list[str], found: list[Bookmark], parse_errors: list[str]) -> tuple[list[str], list[str]]:
    errors = list(parse_errors)
    warnings: list[str] = []
    counts: dict[str, int] = {}
    for bookmark in found:
        counts[bookmark.id] = counts.get(bookmark.id, 0) + 1
        if not VALID_ID_RE.fullmatch(bookmark.id):
            errors.append(f"line {bookmark.line}: invalid bookmark id: {bookmark.id}")
        following = next((line.strip() for line in lines[bookmark.index + 1 :] if line.strip()), "")
        if not following.startswith("#"):
            warnings.append(f"line {bookmark.line}: bookmark {bookmark.id} is not followed by a heading")
    for bookmark_id, count in sorted(counts.items()):
        if count > 1:
            errors.append(f"duplicate bookmark id: {bookmark_id} ({count})")

    index_ids = indexed_ids(lines)
    actual_ids = [bookmark.id for bookmark in found]
    if index_ids is None:
        warnings.append("manual bookmark index not found")
    else:
        missing = sorted(set(actual_ids) - set(index_ids))
        stale = sorted(set(index_ids) - set(actual_ids))
        duplicate_index = sorted({item for item in index_ids if index_ids.count(item) > 1})
        if missing:
            errors.append(f"bookmark index missing ids: {', '.join(missing)}")
        if stale:
            errors.append(f"bookmark index has stale ids: {', '.join(stale)}")
        if duplicate_index:
            errors.append(f"bookmark index duplicates ids: {', '.join(duplicate_index)}")
    return errors, warnings


def note_paths(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    if target.is_dir():
        return sorted(path for path in target.rglob("*.md") if path.is_file())
    raise OSError(f"path not found: {target}")


def load_notes(target: Path) -> tuple[dict[Path, list[str]], list[LocatedBookmark], dict[Path, list[str]]]:
    documents: dict[Path, list[str]] = {}
    located: list[LocatedBookmark] = []
    parse_errors: dict[Path, list[str]] = {}
    for path in note_paths(target):
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        found, errors = parse_bookmarks(lines)
        documents[path] = lines
        parse_errors[path] = errors
        display = path.name if target.is_file() else path.relative_to(target).as_posix()
        located.extend(
            LocatedBookmark(
                note=display,
                id=item.id,
                title=item.title,
                line=item.line,
                index=item.index,
            )
            for item in found
        )
    return documents, located, parse_errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("list", "index", "validate"):
        current = subparsers.add_parser(command)
        current.add_argument("note", type=Path)
        current.add_argument("--json", action="store_true")
    show = subparsers.add_parser("show")
    show.add_argument("note", type=Path)
    show.add_argument("bookmark")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        documents, located, parse_errors = load_notes(args.note)
    except OSError as exc:
        print(f"note_bookmarks: {exc}", file=sys.stderr)
        return 2

    if args.command == "list":
        if args.json:
            print(json.dumps([asdict(item) for item in located], ensure_ascii=False, indent=2))
        else:
            for item in located:
                prefix = f"{item.note}:" if args.note.is_dir() else ""
                print(f"{prefix}{item.id}\tL{item.line}\t{item.title}")
        return 0 if not any(parse_errors.values()) else 1

    if args.command == "index":
        if args.json:
            print(json.dumps([asdict(item) for item in located], ensure_ascii=False, indent=2))
        else:
            for item in located:
                print(f"- `{item.id}` — `{item.note}:L{item.line}` — {item.title}")
        return 0 if not any(parse_errors.values()) else 1

    if args.command == "show":
        matches = [item for item in located if item.id == args.bookmark]
        if not matches:
            print(f"note_bookmarks: bookmark not found: {args.bookmark}", file=sys.stderr)
            return 2
        if len(matches) > 1:
            print(f"note_bookmarks: bookmark is duplicated: {args.bookmark}", file=sys.stderr)
            return 2
        match = matches[0]
        path = args.note if args.note.is_file() else args.note / match.note
        lines = documents[path]
        found, _ = parse_bookmarks(lines)
        start = match.index
        end = next((item.index for item in found if item.index > start), len(lines))
        sys.stdout.write("".join(lines[start:end]))
        return 0

    errors: list[str] = []
    warnings: list[str] = []
    for path, lines in documents.items():
        found, _ = parse_bookmarks(lines)
        file_errors, file_warnings = validate(lines, found, parse_errors[path])
        display = path.name if args.note.is_file() else path.relative_to(args.note).as_posix()
        errors.extend(f"{display}: {item}" for item in file_errors)
        warnings.extend(f"{display}: {item}" for item in file_warnings)
    if args.note.is_dir():
        counts: dict[str, int] = {}
        for item in located:
            counts[item.id] = counts.get(item.id, 0) + 1
        errors.extend(
            f"duplicate bookmark id across notes: {bookmark_id} ({count})"
            for bookmark_id, count in sorted(counts.items())
            if count > 1
        )
    if args.json:
        print(
            json.dumps(
                {
                    "note": str(args.note),
                    "note_count": len(documents),
                    "bookmark_count": len(located),
                    "errors": errors,
                    "warnings": warnings,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        for warning in warnings:
            print(f"warning: {warning}")
        for error in errors:
            print(f"error: {error}")
        if not errors:
            print(f"bookmarks ok: {len(located)} across {len(documents)} note(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
