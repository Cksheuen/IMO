#!/usr/bin/env python3
"""Audit runtime-chain claims in docs against actual hook registrations.

This tool is intentionally read-only. It scans repository documentation for
phrases that imply a workflow is active, extracts referenced hook scripts, and
compares those references with hook commands registered in `settings.json` and
`.claude/settings.json`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
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
NON_RUNTIME_MARKERS = (
    "人工执行",
    "只读",
    "不自动执行",
    "不会自行运行",
    "不属于自动 hook",
)
RUNTIME_ACTION_MARKERS = (
    "挂载",
    "通过",
    "注入",
)
NEGATING_MARKERS = (
    "不能写成",
    "不得写成",
    "未接入",
    "未挂载",
    "缺少真实挂载",
    "误写成",
    "脚本资产层",
    "设计资产",
)
SCRIPT_RE = re.compile(r"(?P<path>(?:\.claude/)?hooks/[\w./-]+\.(?:py|sh))")
SETTINGS_FILES = ("settings.json", ".claude/settings.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit documentation runtime-chain claims against actual hook registrations."
    )
    parser.add_argument("--root", default=".", help="Repository root to scan")
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format",
    )
    parser.add_argument(
        "--include-non-claims",
        action="store_true",
        help="Also report docs that reference hook scripts without claim keywords",
    )
    return parser.parse_args()


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
    if path.startswith("./"):
        return path[2:]
    return path


def extract_registered_scripts(root: Path) -> dict[str, list[str]]:
    registrations: dict[str, list[str]] = {}
    for settings_rel in SETTINGS_FILES:
        settings_path = root / settings_rel
        payload = load_json(settings_path)
        if payload is None:
            continue
        scripts: list[str] = []
        for command in flatten_hook_commands(payload):
            for match in SCRIPT_RE.finditer(command):
                scripts.append(normalize_script_path(match.group("path")))
        registrations[settings_rel] = sorted(set(scripts))
    return registrations


def find_markdown_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.md")
        if ".git/" not in path.as_posix() and "node_modules/" not in path.as_posix()
    )


def classify_scope(script_path: str) -> str:
    return "project" if script_path.startswith(".claude/") else "shared"


def matching_settings(scope: str) -> list[str]:
    if scope == "project":
        return [".claude/settings.json"]
    return ["settings.json"]


def analyze_docs(root: Path, registrations: dict[str, list[str]], include_non_claims: bool) -> list[dict]:
    records: list[dict] = []
    for md_path in find_markdown_files(root):
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
                scope = classify_scope(script_path)
                expected_settings = matching_settings(scope)
                registered_in = [
                    settings
                    for settings, scripts in registrations.items()
                    if script_path in scripts
                ]
                status = "ok" if all(s in registered_in for s in expected_settings) else "missing_registration"
                if not is_runtime_claim:
                    status = "non_runtime_reference"
                records.append(
                    {
                        "doc": rel_path,
                        "line": lineno,
                        "text": line.strip(),
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
    missing = [record for record in records if record["status"] != "ok"]
    missing_registration = [record for record in records if record["status"] == "missing_registration"]
    non_runtime = [record for record in records if record["status"] == "non_runtime_reference"]
    return {
        "root": str(root),
        "settings": registrations,
        "summary": {
            "total_claims": len(records),
            "missing_registration": len(missing_registration),
            "non_runtime_reference": len(non_runtime),
            "non_ok": len(missing),
        },
        "records": records,
    }


def print_text(report: dict) -> None:
    print("Runtime Link Audit")
    print(f"Root: {report['root']}")
    print("Registered scripts:")
    settings_map = report.get("settings", {})
    if not settings_map:
        print("- none")
    else:
        for settings_path, scripts in settings_map.items():
            joined = ", ".join(scripts) if scripts else "(no hook scripts found)"
            print(f"- {settings_path}: {joined}")

    print("Claim summary:")
    summary = report.get("summary", {})
    print(f"- total claim records: {summary.get('total_claims', 0)}")
    print(f"- missing registrations: {summary.get('missing_registration', 0)}")
    print(f"- non-runtime references: {summary.get('non_runtime_reference', 0)}")

    if not report.get("records"):
        print("No matching documentation claims found.")
        return

    print("Details:")
    for record in report["records"]:
        expected = ", ".join(record["expected_settings"])
        registered = ", ".join(record["registered_in"]) or "none"
        print(
            f"- {record['status']}: {record['doc']}:{record['line']} -> {record['script']} "
            f"(expected: {expected}; registered: {registered})"
        )
        if record.get("claim_line") and record.get("claim_line") != record["line"]:
            print(f"  claim context: {record['doc']}:{record['claim_line']} -> {record.get('claim_text', '')}")
        print(f"  {record['text']}")


def main() -> None:
    args = parse_args()
    root = Path(args.root).resolve()
    registrations = extract_registered_scripts(root)
    records = analyze_docs(root, registrations, args.include_non_claims)
    report = summarize(root, registrations, records)

    if args.format == "json":
        json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return

    print_text(report)


if __name__ == "__main__":
    main()
