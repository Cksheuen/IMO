#!/usr/bin/env python3
"""Validate IMO learning-plane policy contracts."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
POLICY_PATH = ROOT / ".imo/learning/policy.json"
SCHEMA_DIR = ROOT / ".imo/learning/schemas"
REQUIRED_SCHEMA_FILES = ["signal.schema.json", "candidate.schema.json", "digest.schema.json"]
REQUIRED_LEVELS = ["raw_signal", "candidate", "active_digest", "hard_rule_or_skill_update"]
REQUIRED_PRIVACY = {"public", "project_private", "sensitive"}
REQUIRED_SCOPES = {"session", "task", "project", "global"}
REQUIRED_GATES = {"candidate_review", "digest_review", "hard_update_task_review"}
REQUIRED_CONTROLS = {"list", "inspect", "disable", "reject", "promote", "reset"}


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _ids(items: Any) -> set[str]:
    if not isinstance(items, list):
        return set()
    return {item.get("id") for item in items if isinstance(item, dict) and isinstance(item.get("id"), str)}


def main() -> int:
    errors: list[str] = []
    try:
        policy = _load_json(POLICY_PATH)
    except OSError as exc:
        print(f"[learning contracts] failed to read {POLICY_PATH}: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"[learning contracts] invalid json in {POLICY_PATH}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(policy, dict):
        errors.append("policy root must be an object")
        policy = {}

    for schema_file in REQUIRED_SCHEMA_FILES:
        schema_path = SCHEMA_DIR / schema_file
        try:
            schema = _load_json(schema_path)
        except OSError as exc:
            errors.append(f"failed to read {schema_path}: {exc}")
            continue
        except json.JSONDecodeError as exc:
            errors.append(f"invalid json in {schema_path}: {exc}")
            continue
        if not isinstance(schema, dict):
            errors.append(f"{schema_path} root must be an object")
            continue
        if schema.get("type") != "object":
            errors.append(f"{schema_path} must declare type=object")
        if not schema.get("properties"):
            errors.append(f"{schema_path} must declare properties")
        if schema_file == "signal.schema.json":
            required = set(schema.get("required", []))
            expected = {
                "id",
                "created_at",
                "source_agent",
                "scope",
                "privacy",
                "confidence",
                "ttl",
                "summary",
            }
            if expected - required:
                errors.append(
                    f"{schema_path} missing required signal fields: {', '.join(sorted(expected - required))}"
                )

    levels = policy.get("levels")
    if not isinstance(levels, list):
        errors.append("levels must be a list")
        levels = []
    level_ids = _ids(levels)
    missing_levels = [level for level in REQUIRED_LEVELS if level not in level_ids]
    if missing_levels:
        errors.append(f"missing levels: {', '.join(missing_levels)}")

    level_by_id = {level.get("id"): level for level in levels if isinstance(level, dict)}
    raw_signal = level_by_id.get("raw_signal", {})
    if raw_signal.get("promotion_gate") != "none":
        errors.append("raw_signal must have promotion_gate=none")
    for level_id in ("candidate", "active_digest", "hard_rule_or_skill_update"):
        gate = level_by_id.get(level_id, {}).get("promotion_gate")
        if gate in (None, "none"):
            errors.append(f"{level_id} must require a promotion gate")

    privacy_classes = policy.get("privacy_classes")
    if not isinstance(privacy_classes, list):
        errors.append("privacy_classes must be a list")
        privacy_classes = []
    privacy_ids = _ids(privacy_classes)
    if REQUIRED_PRIVACY - privacy_ids:
        errors.append(f"missing privacy classes: {', '.join(sorted(REQUIRED_PRIVACY - privacy_ids))}")
    privacy_by_id = {item.get("id"): item for item in privacy_classes if isinstance(item, dict)}
    for privacy_id in ("project_private", "sensitive"):
        if privacy_by_id.get(privacy_id, {}).get("global_allowed") is not False:
            errors.append(f"{privacy_id} must not be globally allowed")

    scopes = policy.get("scopes")
    if not isinstance(scopes, list) or REQUIRED_SCOPES - set(scopes):
        missing = sorted(REQUIRED_SCOPES - set(scopes or []))
        errors.append(f"missing scopes: {', '.join(missing)}")

    gates = policy.get("promotion_gates")
    if not isinstance(gates, list):
        errors.append("promotion_gates must be a list")
        gates = []
    gate_ids = _ids(gates)
    if REQUIRED_GATES - gate_ids:
        errors.append(f"missing promotion gates: {', '.join(sorted(REQUIRED_GATES - gate_ids))}")
    for gate in gates:
        if isinstance(gate, dict) and not gate.get("requires"):
            errors.append(f"{gate.get('id', '<missing-gate>')}: requires must be non-empty")

    transitions = policy.get("scope_transitions")
    if not isinstance(transitions, list):
        errors.append("scope_transitions must be a list")
        transitions = []
    for transition in transitions:
        if not isinstance(transition, dict):
            errors.append("scope transition entries must be objects")
            continue
        if transition.get("from") not in REQUIRED_SCOPES or transition.get("to") not in REQUIRED_SCOPES:
            errors.append(f"invalid scope transition: {transition}")
        if transition.get("to") == "global" and transition.get("requires_privacy") != "public":
            errors.append("global scope transitions must require public privacy")

    permissions = policy.get("agent_permissions")
    if not isinstance(permissions, dict):
        errors.append("agent_permissions must be an object")
        permissions = {}
    public_permissions = permissions.get("public_agents", {})
    if not isinstance(public_permissions, dict):
        errors.append("agent_permissions.public_agents must be an object")
        public_permissions = {}
    if public_permissions.get("can_write_levels") != ["raw_signal"]:
        errors.append("public agents may only write raw_signal by default")
    if "active_digest" not in public_permissions.get("can_read_levels", []):
        errors.append("public agents must be able to read active_digest")

    hermes_permissions = permissions.get("hermes_like_self_iteration", {})
    if not isinstance(hermes_permissions, dict):
        errors.append("agent_permissions.hermes_like_self_iteration must be an object")
        hermes_permissions = {}
    hermes_writes = set(hermes_permissions.get("can_write_levels", []))
    if hermes_writes != {"candidate"}:
        errors.append("Hermes-like self-iteration may only write candidates")

    safety = policy.get("safety_defaults")
    if not isinstance(safety, dict):
        errors.append("safety_defaults must be an object")
        safety = {}
    if safety.get("candidate_only_self_iteration") is not True:
        errors.append("candidate_only_self_iteration must be true")
    if safety.get("global_learning_requires_public_privacy") is not True:
        errors.append("global_learning_requires_public_privacy must be true")
    controls = set(safety.get("required_user_controls", []))
    if REQUIRED_CONTROLS - controls:
        errors.append(f"missing required user controls: {', '.join(sorted(REQUIRED_CONTROLS - controls))}")

    if errors:
        print("[learning contracts] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"[learning contracts] ok: {len(levels)} level(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
