#!/usr/bin/env python3
"""Validate IMO product rule contracts."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
RULES_PATH = ROOT / ".imo/product/rules/rules.json"
RULES_ROOT = ROOT / ".imo/product/rules"
REQUIRED_PRIORITY = [
    "explicit_user_instruction",
    "repository_hard_rules_or_specs",
    "local_neighboring_patterns",
    "active_imo_learning_digest",
    "generic_agent_training_defaults",
]
REQUIRED_CHAMELEON_HABITS = {
    "heavy_defensive_programming_without_local_boundary_need",
    "premature_abstraction",
    "broad_rewrites",
}


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _string_list(value: Any) -> list[str] | None:
    if not isinstance(value, list) or any(not _non_empty_string(item) for item in value):
        return None
    return list(value)


def _has_heading(markdown: str, heading: str) -> bool:
    return f"## {heading}" in markdown or f"# {heading}" in markdown


def _validate_rule(rule: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    rule_id = rule.get("id", "<missing-id>")

    for field in ("id", "name", "status", "owner_surface", "trigger"):
        if not _non_empty_string(rule.get(field)):
            errors.append(f"{rule_id}: {field} must be a non-empty string")

    if rule.get("status") != "active":
        errors.append(f"{rule_id}: status must be active")
    if rule.get("default_enabled") is not True:
        errors.append(f"{rule_id}: default_enabled must be true")

    priority = _string_list(rule.get("priority_order"))
    if priority is None:
        errors.append(f"{rule_id}: priority_order must be a list of strings")

    habits = _string_list(rule.get("overrides_generic_habits"))
    if habits is None:
        errors.append(f"{rule_id}: overrides_generic_habits must be a list of strings")
        habits_set: set[str] = set()
    else:
        habits_set = set(habits)
    integration_modes = _string_list(rule.get("integration_modes"))
    if integration_modes is None:
        errors.append(f"{rule_id}: integration_modes must be a list of strings")
    elif "context-guidance" not in integration_modes:
        errors.append(f"{rule_id}: integration_modes must include context-guidance")
    elif not _non_empty_string(rule.get("context_summary")):
        errors.append(f"{rule_id}: context_summary must be set for context-guidance rules")

    learning_access = rule.get("learning_access")
    if not isinstance(learning_access, dict):
        errors.append(f"{rule_id}: learning_access must be an object")
    else:
        for field in ("read_digest", "write_signals"):
            if not isinstance(learning_access.get(field), bool):
                errors.append(f"{rule_id}: learning_access.{field} must be boolean")

    owner_surface = rule.get("owner_surface")
    if _non_empty_string(owner_surface):
        surface = ROOT / owner_surface
        if not surface.is_file():
            errors.append(f"{rule_id}: owner_surface missing: {owner_surface}")
            markdown = ""
        else:
            markdown = surface.read_text(encoding="utf-8")
    else:
        markdown = ""

    required_sections = _string_list(rule.get("required_sections"))
    if required_sections is None:
        errors.append(f"{rule_id}: required_sections must be a list of strings")
    else:
        for section in required_sections:
            if markdown and not _has_heading(markdown, section):
                errors.append(f"{rule_id}: owner_surface missing section {section!r}")

    if rule_id == "chameleon":
        if priority != REQUIRED_PRIORITY:
            errors.append(f"{rule_id}: priority_order must preserve Chameleon precedence")
        missing_habits = REQUIRED_CHAMELEON_HABITS - habits_set
        if missing_habits:
            errors.append(f"{rule_id}: missing required generic-habit overrides: {', '.join(sorted(missing_habits))}")
        required_phrases = [
            "Generic model defaults lose when local evidence is clear.",
            "heavy defensive programming",
            "neighboring files and existing tests",
            "When departing, state the reason",
        ]
        for phrase in required_phrases:
            if markdown and phrase not in markdown:
                errors.append(f"{rule_id}: owner_surface missing required phrase: {phrase}")

    return errors


def main() -> int:
    errors: list[str] = []
    try:
        metadata = _load_json(RULES_PATH)
    except OSError as exc:
        print(f"[rule contracts] failed to read {RULES_PATH}: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"[rule contracts] invalid json in {RULES_PATH}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(metadata, dict):
        errors.append("rules metadata root must be an object")
        metadata = {}
    if metadata.get("schema_version") != 1:
        errors.append("schema_version must be 1")

    rules = metadata.get("rules")
    if not isinstance(rules, list) or not rules:
        errors.append("rules must be a non-empty list")
        rules = []

    seen_ids: set[str] = set()
    for rule in rules:
        if not isinstance(rule, dict):
            errors.append("each rule entry must be an object")
            continue
        rule_id = rule.get("id")
        if rule_id in seen_ids:
            errors.append(f"{rule_id}: duplicate rule id")
        if isinstance(rule_id, str):
            seen_ids.add(rule_id)
        errors.extend(_validate_rule(rule))

    rule_docs = {
        path.stem
        for path in RULES_ROOT.glob("*.md")
        if path.name != "CONTRACT.md"
    }
    missing_metadata = sorted(rule_docs - seen_ids)
    if missing_metadata:
        errors.append(f"rule documents missing metadata: {', '.join(missing_metadata)}")
    if "chameleon" not in seen_ids:
        errors.append("missing required chameleon rule")

    if errors:
        print("[rule contracts] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"[rule contracts] ok: {len(rules)} rule(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
