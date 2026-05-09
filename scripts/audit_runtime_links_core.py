"""Core analysis helpers for audit-runtime-links."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

CLAIM_PATTERNS = (
    "已落地",
    "已经落地",
    "当前运行时协议",
    "当前最小执行链",
    "自动触发",
    "已接通",
)
NON_RUNTIME_MARKERS = ("人工执行", "只读", "不自动执行", "不会自行运行", "不属于自动 hook")
RUNTIME_ACTION_MARKERS = ("挂载", "通过", "注入")
NEGATING_MARKERS = ("不能写成", "不得写成", "未接入", "未挂载", "缺少真实挂载", "误写成", "脚本资产层", "设计资产")
SCRIPT_RE = re.compile(r"(?P<path>(?:\.claude/)?hooks/[\w./-]+\.(?:py|sh))")
SETTINGS_FILES = ("settings.json", ".claude/settings.json")

__all__ = [
    "SETTINGS_FILES",
    "SCRIPT_RE",
    "analyze_docs",
    "extract_registered_scripts",
    "summarize",
]


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def flatten_hook_commands(payload: dict) -> list[str]:
    hooks = payload.get("hooks", {})
    commands: list[str] = []

    def collect_items(items: Iterable[dict]) -> None:
        for item in items:
            if not isinstance(item, dict):
                continue
            command = item.get("command")
            if isinstance(command, str):
                commands.append(command)
            nested = item.get("hooks")
            if isinstance(nested, list):
                collect_items(nested)

    if isinstance(hooks, dict):
        for value in hooks.values():
            if isinstance(value, list):
                collect_items(value)
    return commands


def normalize_script_path(raw: str) -> str:
    path = raw.strip()
    return path[2:] if path.startswith("./") else path


def extract_registered_scripts(root: Path) -> dict[str, list[str]]:
    registrations: dict[str, list[str]] = {}
    for settings_rel in SETTINGS_FILES:
        payload = load_json(root / settings_rel)
        if payload is None:
            continue
        scripts: list[str] = []
        for command in flatten_hook_commands(payload):
            for match in SCRIPT_RE.finditer(command):
                scripts.append(normalize_script_path(match.group("path")))
        registrations[settings_rel] = sorted(set(scripts))
    return registrations


def _find_markdown_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.md")
        if ".git/" not in path.as_posix() and "node_modules/" not in path.as_posix()
    )


def _classify_scope(script_path: str) -> str:
    return "project" if script_path.startswith(".claude/") else "shared"


def _matching_settings(scope: str) -> list[str]:
    return [".claude/settings.json"] if scope == "project" else ["settings.json"]


def analyze_docs(root: Path, registrations: dict[str, list[str]], include_non_claims: bool) -> list[dict]:
    records: list[dict] = []
    for md_path in _find_markdown_files(root):
        rel_path = md_path.relative_to(root).as_posix()
        try:
            lines = md_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue

        active_claim_line: int | None = None
        active_claim_text = ""
        for lineno, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                active_claim_line = None
                active_claim_text = ""

            line_has_claim = any(pattern in line for pattern in CLAIM_PATTERNS)
            line_is_negated = any(marker in line for marker in NEGATING_MARKERS)
            if line_has_claim and not line_is_negated:
                active_claim_line = lineno
                active_claim_text = stripped

            matches = [normalize_script_path(m.group("path")) for m in SCRIPT_RE.finditer(line)]
            if not matches:
                continue

            has_claim = (line_has_claim and not line_is_negated) or (
                active_claim_line is not None and any(marker in line for marker in RUNTIME_ACTION_MARKERS)
            )
            if not has_claim and not include_non_claims:
                continue

            for script_path in matches:
                is_runtime_claim = not any(marker in line for marker in NON_RUNTIME_MARKERS) and not any(
                    marker in active_claim_text for marker in NON_RUNTIME_MARKERS
                )
                scope = _classify_scope(script_path)
                expected_settings = _matching_settings(scope)
                registered_in = [settings for settings, scripts in registrations.items() if script_path in scripts]
                status = "ok" if all(s in registered_in for s in expected_settings) else "missing_registration"
                if not is_runtime_claim:
                    status = "non_runtime_reference"
                records.append(
                    {
                        "doc": rel_path,
                        "line": lineno,
                        "text": stripped,
                        "script": script_path,
                        "scope": scope,
                        "is_claim": has_claim,
                        "claim_line": active_claim_line if active_claim_line != lineno else lineno,
                        "claim_text": active_claim_text if active_claim_line != lineno else stripped,
                        "expected_settings": expected_settings,
                        "registered_in": registered_in,
                        "status": status,
                    }
                )
    return records


def summarize(root: Path, registrations: dict[str, list[str]], records: list[dict]) -> dict:
    missing_registration = [record for record in records if record["status"] == "missing_registration"]
    non_runtime = [record for record in records if record["status"] == "non_runtime_reference"]
    return {
        "root": str(root),
        "settings": registrations,
        "summary": {
            "total_claims": len(records),
            "missing_registration": len(missing_registration),
            "non_runtime_reference": len(non_runtime),
            "non_ok": len([record for record in records if record["status"] != "ok"]),
        },
        "records": records,
    }
