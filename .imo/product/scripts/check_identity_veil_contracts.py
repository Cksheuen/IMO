#!/usr/bin/env python3
"""Validate IMO identity-veil contracts."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / ".imo/runtime/identity-veil/CONTRACT.md"
SCHEMA_PATH = ROOT / ".imo/runtime/identity-veil/schema.json"
SCRIPT_PATH = ROOT / ".imo/product/scripts/identity_veil.py"
SCRIPT_DIR = ROOT / ".imo/product/scripts"

REQUIRED_PHRASES = (
    "Identity Veil Runtime Contract",
    "./imo veil gate",
    "./imo veil context",
    "./imo veil register",
    "./imo veil run",
    "./imo veil read",
    "--task",
    "sanitize",
    "opaque",
    "PreToolUse",
    "SessionStart",
    "opt-in",
)


def _load_json(path: Path) -> object:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    errors: list[str] = []

    if not CONTRACT_PATH.is_file():
        errors.append(f"missing contract: {CONTRACT_PATH}")
    else:
        contract = CONTRACT_PATH.read_text(encoding="utf-8")
        for phrase in REQUIRED_PHRASES:
            if phrase not in contract:
                errors.append(f"contract missing required phrase: {phrase}")

    try:
        schema = _load_json(SCHEMA_PATH)
    except OSError as exc:
        errors.append(f"failed to read schema: {exc}")
        schema = {}
    except json.JSONDecodeError as exc:
        errors.append(f"invalid schema json: {exc}")
        schema = {}

    if not isinstance(schema, dict):
        errors.append("schema root must be an object")
        schema = {}
    if schema.get("type") != "object":
        errors.append("schema must declare type=object")
    required = set(schema.get("required", []))
    expected = {"schema_version", "enabled", "commands", "paths", "patterns"}
    missing = expected - required
    if missing:
        errors.append(f"schema missing required fields: {', '.join(sorted(missing))}")
    for entry_name in ("commands", "paths"):
        entry_required = set(
            schema.get("properties", {}).get(entry_name, {}).get("items", {}).get("required", [])
        )
        if "alias" not in entry_required:
            errors.append(f"schema {entry_name} items must require an alias handle")

    if not SCRIPT_PATH.is_file():
        errors.append(f"missing runner: {SCRIPT_PATH}")
    else:
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "selftest"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if result.returncode != 0:
            errors.append("identity_veil selftest failed")
            errors.extend(f"  {line}" for line in result.stderr.splitlines() if line.strip())

        sys.path.insert(0, str(SCRIPT_DIR))
        try:
            import identity_veil
        except Exception as exc:  # pragma: no cover - defensive contract diagnostics
            errors.append(f"failed to import identity_veil.py: {exc}")
        else:
            # Privacy boundary: tracked source ships the mechanism only, never a
            # real organization command/path mapping.
            if identity_veil.BUILTIN_COMMANDS or identity_veil.BUILTIN_PATHS:
                errors.append("built-in command/path maps must stay empty; real mappings are user-policy-only")

            policy = {
                "schema_version": 1,
                "enabled": True,
                "commands": [
                    {"match": "examplecli", "alias": "org-cli-1", "action": "sanitize"}
                ],
                "paths": [
                    {"prefix": str(Path.home() / ".examplecli"), "alias": "org-config-1", "action": "opaque"}
                ],
                "patterns": identity_veil.BUILTIN_PATTERNS,
            }
            command_match = identity_veil.classify_command("examplecli whoami", policy)
            if not command_match or command_match.get("alias") != "org-cli-1":
                errors.append("registered command must classify with its neutral alias")
            if command_match and "examplecli" in command_match.get("rewrite", ""):
                errors.append("deny rewrite must not echo the real command name")
            if identity_veil.resolve_command_alias("org-cli-1", policy) != "examplecli":
                errors.append("command handle must resolve locally to the real basename")
            path_match = identity_veil.classify_path(str(Path.home() / ".examplecli" / "config"), policy)
            if not path_match or path_match.get("action") != "opaque":
                errors.append("registered path must classify opaque")
            opaque = identity_veil._redact(
                "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.signaturepart12", policy
            )
            if opaque.get("level") != "opaque":
                errors.append("opaque redaction level must escalate on token patterns")

    if errors:
        print("[identity veil contracts] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("[identity veil contracts] ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
