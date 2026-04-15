#!/usr/bin/env python3
"""Build a lightweight index for on-demand rule injection."""

from __future__ import annotations

import json
import re
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
OUTPUT_PATH = CLAUDE_DIR / "rules-index.json"
SEARCH_DIRS = (CLAUDE_DIR / "rules", CLAUDE_DIR / "rules-library")
DOMAIN_KEYWORDS = {
    "domain/frontend": ["前端", "frontend", "组件", "页面", "component", "react", "css", "tailwind", "ui"],
    "domain/backend": ["后端", "backend", "api", "handler", "controller", "route"],
    "domain/ml": ["训练", "ml", "模型", "training", "dataset"],
    "domain/native": ["桌面", "native", "rust", "egui"],
    "pattern/": ["模式", "pattern"],
    "technique/": ["技术", "technique"],
    "tool/": ["工具", "tool"],
}


def iter_rule_files() -> list[Path]:
    files: list[Path] = []
    for base in SEARCH_DIRS:
        if not base.exists():
            continue
        files.extend(sorted(path for path in base.rglob("*.md") if path.is_file()))
    return files


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return fallback


def extract_trigger_section(text: str) -> str:
    lines = text.splitlines()
    in_trigger = False
    collected: list[str] = []
    for line in lines:
        match = re.match(r"^(#{2,6})\s+(.+?)\s*$", line.strip())
        if match:
            heading = re.sub(r"\s*[\(（].*$", "", match.group(2)).strip()
            if in_trigger:
                break
            if heading == "触发条件":
                in_trigger = True
                continue
        if in_trigger:
            collected.append(line)
    return "\n".join(collected).strip()


def split_cjk_fragments(text: str) -> list[str]:
    fragments = re.findall(r"[\u4e00-\u9fff]{2,}", text)
    return fragments


def extract_chinese_keywords(text: str) -> list[str]:
    keywords: list[str] = []
    for fragment in split_cjk_fragments(text):
        keywords.append(fragment)
        max_len = min(len(fragment), 8)
        for size in range(2, max_len + 1):
            for start in range(0, len(fragment) - size + 1):
                keywords.append(fragment[start:start + size])
    return keywords


def extract_english_keywords(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{1,}", text.lower())


def derive_path_keywords(rel_path: str) -> list[str]:
    keywords: list[str] = []
    normalized = rel_path.replace("\\", "/")
    for marker, words in DOMAIN_KEYWORDS.items():
        if marker in normalized:
            keywords.extend(words)
    parts = [part for part in normalized.split("/") if part not in {"rules", "rules-library"}]
    for part in parts:
        if part.endswith(".md"):
            part = part[:-3]
        for token in re.split(r"[-_.]+", part):
            if len(token) >= 2:
                keywords.append(token.lower())
    return keywords


def normalize_keywords(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        keyword = re.sub(r"\s+", "", item.strip().lower())
        if len(keyword) < 2:
            continue
        if keyword in seen:
            continue
        seen.add(keyword)
        result.append(keyword)
    return result


def build_entry(path: Path) -> dict[str, object] | None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None

    rel_path = path.relative_to(CLAUDE_DIR).as_posix()
    title = extract_title(text, path.stem.replace("-", " "))
    trigger_section = extract_trigger_section(text)
    keywords = normalize_keywords(
        extract_chinese_keywords(trigger_section)
        + extract_english_keywords(trigger_section)
        + extract_chinese_keywords(title)
        + extract_english_keywords(title)
        + derive_path_keywords(rel_path)
    )

    return {
        "path": rel_path,
        "title": title,
        "keywords": keywords,
        "size_bytes": path.stat().st_size,
        "always_loaded": rel_path.startswith("rules/"),
    }


def main() -> int:
    entries = [entry for path in iter_rule_files() if (entry := build_entry(path))]
    OUTPUT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
