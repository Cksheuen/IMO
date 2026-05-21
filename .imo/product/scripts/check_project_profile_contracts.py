#!/usr/bin/env python3
"""Validate IMO project-profile contracts."""

from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / ".imo/runtime/project-profile/CONTRACT.md"
SCHEMA_PATH = ROOT / ".imo/runtime/project-profile/schema.json"
SCRIPT_DIR = ROOT / ".imo/product/scripts"


def _load_json(path: Path) -> object:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    errors: list[str] = []
    if not CONTRACT_PATH.is_file():
        errors.append(f"missing contract: {CONTRACT_PATH}")
    else:
        contract = CONTRACT_PATH.read_text(encoding="utf-8")
        for phrase in (
            "Prompt-time hooks must not scan the repository",
            "./imo profile refresh",
            ".imo/.runtime/project-profile/current.json",
            "Chameleon may use the profile as a starting point",
        ):
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
    expected = {
        "schema_version",
        "profile_id",
        "repo_root",
        "generated_at",
        "git",
        "source_fingerprint",
        "summary",
        "conventions",
        "evidence",
        "limits",
    }
    missing = expected - required
    if missing:
        errors.append(f"schema missing required fields: {', '.join(sorted(missing))}")

    sys.path.insert(0, str(SCRIPT_DIR))
    try:
        import project_profile
    except Exception as exc:  # pragma: no cover - defensive contract diagnostics
        errors.append(f"failed to import project_profile.py: {exc}")
    else:
        info = project_profile.status_info()
        if info.get("status") not in {"missing", "current", "stale", "invalid"}:
            errors.append("project_profile.status_info returned unsupported status")

    if errors:
        print("[project profile contracts] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("[project profile contracts] ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
