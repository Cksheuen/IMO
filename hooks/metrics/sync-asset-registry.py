#!/usr/bin/env python3
"""Scan skill/rule assets and sync the local metrics registries."""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable


CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude"))).expanduser()
SKILLS_DIR = CLAUDE_HOME / "skills"
RULES_DIRS = (CLAUDE_HOME / "rules", CLAUDE_HOME / "rules-library")
SKILL_INJECT_PATH = CLAUDE_HOME / "hooks" / "skill-loader" / "skill-inject.sh"
RULES_INDEX_PATH = CLAUDE_HOME / "rules-index.json"
BUILD_DESC_PATH = CLAUDE_HOME / "hooks" / "metrics" / "build-asset-descriptions.py"

FRONTMATTER_BOUNDARY = "---"
SIMPLE_FIELD_RE = re.compile(r"^([A-Za-z0-9_]+):\s*(.*)$")
KEYWORD_MAP_RE = re.compile(r"(?ms)^KEYWORD_SKILL_MAP=\(\n.*?^\)")
KEYWORD_ENTRY_RE = re.compile(r'"(.+)"')
TITLE_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
TITLE_TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+")
STOPWORDS = {
    "",
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "vs",
}
SCALAR_MARKERS = {">", "|", ">-", "|-", ">+", "|+"}


def strip_wrapping_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def extract_frontmatter_block(text: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != FRONTMATTER_BOUNDARY:
        return ""

    collected: list[str] = []
    for line in lines[1:]:
        if line.strip() == FRONTMATTER_BOUNDARY:
            return "\n".join(collected)
        collected.append(line)
    return ""


def parse_simple_mapping(block: str) -> dict[str, str]:
    data: dict[str, str] = {}
    current_key = ""
    scalar_mode = False

    for raw_line in block.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        match = SIMPLE_FIELD_RE.match(line)
        if match:
            current_key = match.group(1)
            value = strip_wrapping_quotes(match.group(2))
            scalar_mode = value in SCALAR_MARKERS
            data[current_key] = "" if scalar_mode else value
            continue

        if current_key and raw_line[:1].isspace():
            continuation = stripped
            if continuation.startswith("- "):
                continuation = continuation[2:].strip()
            continuation = strip_wrapping_quotes(continuation)
            if not continuation:
                continue

            separator = "\n" if current_key == "triggers" else " "
            if scalar_mode and current_key != "triggers":
                separator = " "
            existing = data.get(current_key, "")
            data[current_key] = f"{existing}{separator if existing else ''}{continuation}".strip()

    return data


def read_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    block = extract_frontmatter_block(text)
    if not block:
        return {}
    return parse_simple_mapping(block)


def normalize_trigger_entries(raw: str) -> list[str]:
    entries: list[str] = []
    for piece in raw.splitlines():
        entry = piece.strip()
        if not entry:
            continue
        if entry.startswith("- "):
            entry = entry[2:].strip()
        entry = strip_wrapping_quotes(entry)
        if entry:
            entries.append(entry)
    return entries


def compact_reason(text: str, limit: int = 20) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return ""
    return normalized[:limit]


def shell_unescape(value: str) -> str:
    """Reverse the escaping applied by shell_double_quote."""
    return value.replace("\\`", "`").replace("\\$", "$").replace('\\"', '"').replace("\\\\", "\\")


def parse_existing_keyword_map() -> dict[str, list[str]]:
    """Parse existing KEYWORD_SKILL_MAP from skill-inject.sh, keyed by skill name.

    Returns un-escaped entries so they can be safely re-escaped by render_keyword_skill_map.
    """
    existing: dict[str, list[str]] = {}
    try:
        text = SKILL_INJECT_PATH.read_text(encoding="utf-8")
    except OSError:
        return existing
    match = KEYWORD_MAP_RE.search(text)
    if not match:
        return existing
    for line in match.group(0).splitlines():
        entry_match = KEYWORD_ENTRY_RE.search(line.strip())
        if not entry_match:
            continue
        entry = shell_unescape(entry_match.group(1))
        # Extract skill name (second colon-separated field)
        parts = entry.split(":")
        if len(parts) >= 2:
            skill = parts[1]
            existing.setdefault(skill, []).append(entry)
    return existing


def build_skill_entries(skills_dir: Path) -> tuple[list[str], int]:
    existing_map = parse_existing_keyword_map()
    entries: list[str] = []
    skill_files = sorted(skills_dir.glob("*/SKILL.md"), key=lambda path: path.parent.name.lower())

    for skill_file in skill_files:
        frontmatter = read_frontmatter(skill_file)
        skill_name = frontmatter.get("name", "").strip() or skill_file.parent.name
        triggers = normalize_trigger_entries(frontmatter.get("triggers", ""))

        if triggers:
            # Explicit triggers declared — use them
            entries.extend(triggers)
            continue

        # No triggers: preserve existing manual mapping if present
        if skill_name in existing_map:
            entries.extend(existing_map[skill_name])
            continue

        # Completely new skill with no triggers and no existing mapping — generate fallback
        description = (
            frontmatter.get("description_zh", "").strip()
            or frontmatter.get("description", "").strip()
            or frontmatter.get("description_en", "").strip()
        )
        reason = compact_reason(description) or skill_name
        entries.append(f"{skill_name}:{skill_name}:{reason}")

    return entries, len(skill_files)


def shell_double_quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("`", "\\`")


def render_keyword_skill_map(entries: Iterable[str]) -> str:
    rendered = "\n".join(f'    "{shell_double_quote(entry)}"' for entry in entries)
    return f"KEYWORD_SKILL_MAP=(\n{rendered}\n)"


def atomic_write_text(path: Path, content: str, mode: int | None = None) -> bool:
    existing = None
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if existing == content:
            return False
        if mode is None:
            mode = stat.S_IMODE(path.stat().st_mode)
    elif mode is None:
        mode = 0o644

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.chmod(temp_path, mode)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return True


def update_skill_inject(entries: list[str]) -> None:
    original = SKILL_INJECT_PATH.read_text(encoding="utf-8")
    replacement = render_keyword_skill_map(entries)
    updated, count = KEYWORD_MAP_RE.subn(replacement, original, count=1)
    if count != 1:
        raise RuntimeError(f"Failed to locate KEYWORD_SKILL_MAP in {SKILL_INJECT_PATH}")
    atomic_write_text(SKILL_INJECT_PATH, updated)


def extract_title(text: str, fallback: str) -> str:
    match = TITLE_RE.search(text)
    if match:
        return match.group(1).strip()
    return fallback


def tokenize_title(title: str) -> list[str]:
    tokens: list[str] = []
    for token in TITLE_TOKEN_RE.findall(title.lower()):
        if token in STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def filename_segments(path: Path) -> list[str]:
    segments: list[str] = []
    for token in re.split(r"[^A-Za-z0-9\u4e00-\u9fff]+", path.stem.lower()):
        if token and token not in STOPWORDS:
            segments.append(token)
    return segments


def unique_stable(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def load_rules_index() -> list[dict[str, object]]:
    try:
        entries = json.loads(RULES_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in {RULES_INDEX_PATH}") from exc

    if not isinstance(entries, list):
        raise RuntimeError(f"{RULES_INDEX_PATH} must contain a JSON array")
    return entries


def scan_rule_files() -> list[Path]:
    paths: list[Path] = []
    for rules_dir in RULES_DIRS:
        if not rules_dir.exists():
            continue
        paths.extend(sorted(rules_dir.rglob("*.md")))
    return sorted(paths, key=lambda path: path.relative_to(CLAUDE_HOME).as_posix())


def append_rules_index() -> tuple[int, int]:
    existing_entries = load_rules_index()
    existing_paths = {
        str(entry.get("path", "")).strip()
        for entry in existing_entries
        if isinstance(entry, dict)
    }

    rule_files = scan_rule_files()
    new_entries: list[dict[str, object]] = []

    for rule_file in rule_files:
        relative_path = rule_file.relative_to(CLAUDE_HOME).as_posix()
        if relative_path in existing_paths:
            continue

        text = rule_file.read_text(encoding="utf-8")
        title = extract_title(text, rule_file.stem)
        strong_keywords = unique_stable(filename_segments(rule_file) + tokenize_title(title))
        new_entries.append(
            {
                "path": relative_path,
                "title": title,
                "strong_keywords": strong_keywords,
                "keywords": [],
                "size_bytes": rule_file.stat().st_size,
                "always_loaded": rule_file.is_relative_to(CLAUDE_HOME / "rules"),
            }
        )

    if new_entries:
        updated_entries = [*existing_entries, *new_entries]
        content = json.dumps(updated_entries, ensure_ascii=False, indent=2) + "\n"
        atomic_write_text(RULES_INDEX_PATH, content)

    return len(rule_files), len(new_entries)


def rebuild_asset_descriptions() -> None:
    subprocess.run(["python3", str(BUILD_DESC_PATH)], check=True)


def main() -> int:
    skill_entries, skill_count = build_skill_entries(SKILLS_DIR)
    update_skill_inject(skill_entries)
    rule_count, new_rule_count = append_rules_index()
    rebuild_asset_descriptions()

    print(f"sync-asset-registry: scanned {skill_count} skills, {rule_count} rules")
    print(f"  - rules-index.json: {new_rule_count} new entries added")
    print(f"  - skill-inject.sh: KEYWORD_SKILL_MAP updated ({len(skill_entries)} entries)")
    print("  - asset-descriptions.json: rebuilt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
