#!/usr/bin/env python3
"""Build hook / skill / rule descriptions for the metrics dashboard."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    yaml = None


CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude"))).expanduser()
METRICS_DIR = CLAUDE_HOME / "metrics"
SKILLS_DIR = CLAUDE_HOME / "skills"
HOOK_CATALOG_PATH = METRICS_DIR / "asset-catalog.yaml"
RULES_INDEX_PATH = CLAUDE_HOME / "rules-index.json"
OUTPUT_PATH = METRICS_DIR / "asset-descriptions.json"

FRONTMATTER_BOUNDARY = "---"
CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")
SIMPLE_FIELD_RE = re.compile(r"^([A-Za-z0-9_]+):\s*(.*)$")


def strip_wrapping_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def detect_language(text: str) -> str:
    return "zh" if CHINESE_RE.search(text or "") else "en"


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

    for raw_line in block.splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue

        match = SIMPLE_FIELD_RE.match(line)
        if match:
            current_key = match.group(1)
            data[current_key] = strip_wrapping_quotes(match.group(2))
            continue

        if current_key and raw_line[:1].isspace():
            continuation = strip_wrapping_quotes(line)
            if continuation:
                joined = f"{data[current_key]} {continuation}".strip()
                data[current_key] = joined

    return data


def load_yaml_mapping(text: str) -> dict[str, object]:
    if yaml is None:
        return {}

    try:
        loaded = yaml.safe_load(text)
    except Exception:
        return {}

    return loaded if isinstance(loaded, dict) else {}


def load_frontmatter(path: Path) -> dict[str, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}

    block = extract_frontmatter_block(text)
    if not block:
        return {}

    parsed = load_yaml_mapping(block)
    if parsed:
        result: dict[str, str] = {}
        for key, value in parsed.items():
            if value is None:
                result[str(key)] = ""
            elif isinstance(value, str):
                result[str(key)] = value.strip()
            else:
                result[str(key)] = str(value)
        return result

    return parse_simple_mapping(block)


def parse_asset_catalog_manually(text: str) -> list[dict[str, str]]:
    assets: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    in_assets = False

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped == "assets:":
            in_assets = True
            continue

        if not in_assets:
            continue

        if stripped.startswith("- "):
            if current:
                assets.append(current)
            current = {}
            stripped = stripped[2:].strip()
            if stripped:
                match = SIMPLE_FIELD_RE.match(stripped)
                if match:
                    current[match.group(1)] = strip_wrapping_quotes(match.group(2))
            continue

        if current is None:
            continue

        match = SIMPLE_FIELD_RE.match(stripped)
        if match:
            current[match.group(1)] = strip_wrapping_quotes(match.group(2))

    if current:
        assets.append(current)

    return assets


def load_hook_descriptions(path: Path) -> dict[str, dict[str, str]]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"Failed to read hook catalog: {path}") from exc

    assets: list[dict[str, object]] = []
    parsed = load_yaml_mapping(text)
    if parsed:
        raw_assets = parsed.get("assets", [])
        if isinstance(raw_assets, list):
            for item in raw_assets:
                if isinstance(item, dict):
                    assets.append(item)
    else:
        assets = parse_asset_catalog_manually(text)

    result: dict[str, dict[str, str]] = {}
    for item in assets:
        asset_id = str(item.get("id", "")).strip()
        if not asset_id:
            continue
        result[asset_id] = {
            "description_zh": str(item.get("description_zh", "")).strip(),
            "description_en": str(item.get("description_en", "")).strip(),
        }
    return result


def build_skill_descriptions(skills_dir: Path) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}

    for skill_file in sorted(skills_dir.glob("*/SKILL.md")):
        frontmatter = load_frontmatter(skill_file)
        if not frontmatter:
            continue

        name = frontmatter.get("name", "").strip() or skill_file.parent.name
        description = frontmatter.get("description", "").strip()
        description_zh = frontmatter.get("description_zh", "").strip()
        description_en = frontmatter.get("description_en", "").strip()

        if description:
            raw_language = detect_language(description)
            if raw_language == "zh" and not description_zh:
                description_zh = description
            if raw_language == "en" and not description_en:
                description_en = description

        result[name] = {
            "description_zh": description_zh,
            "description_en": description_en,
        }

    return result


def load_rule_descriptions(path: Path) -> dict[str, dict[str, object]]:
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuntimeError(f"Failed to read rules index: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in rules index: {path}") from exc

    if not isinstance(entries, list):
        raise RuntimeError(f"Rules index must be a JSON array: {path}")

    result: dict[str, dict[str, object]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        rule_path = str(entry.get("path", "")).strip()
        if not rule_path:
            continue
        result[rule_path] = {
            "title": str(entry.get("title", "")).strip(),
            "always_loaded": bool(entry.get("always_loaded", False)),
        }
    return result


def build_payload() -> dict[str, object]:
    return {
        "hooks": load_hook_descriptions(HOOK_CATALOG_PATH),
        "skills": build_skill_descriptions(SKILLS_DIR),
        "rules": load_rule_descriptions(RULES_INDEX_PATH),
    }


def main() -> int:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(build_payload(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
