#!/usr/bin/env python3
"""Validate IMO skill module metadata."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
METADATA_PATH = ROOT / ".imo/product/skills/modules.json"
MODULES_ROOT = ROOT / ".imo/product/skills"
REQUIRED_CLASSIFICATIONS = {"native", "provider-backed", "extension-candidate"}
REQUIRED_FIELDS = {
    "id",
    "name",
    "classification",
    "owner_surface",
    "lifecycle",
    "default_enabled",
    "allowed_integration_modes",
    "external_dependencies",
    "learning_access",
}


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _validate_module(module: dict[str, Any], allowed_classifications: set[str], allowed_modes: set[str]) -> list[str]:
    errors: list[str] = []
    module_id = module.get("id", "<missing-id>")

    missing = sorted(REQUIRED_FIELDS - module.keys())
    if missing:
        errors.append(f"{module_id}: missing fields: {', '.join(missing)}")

    for field in ("id", "name", "classification", "owner_surface", "lifecycle"):
        if field in module and not _is_non_empty_string(module[field]):
            errors.append(f"{module_id}: {field} must be a non-empty string")

    classification = module.get("classification")
    if classification not in allowed_classifications:
        errors.append(f"{module_id}: invalid classification {classification!r}")

    if not isinstance(module.get("default_enabled"), bool):
        errors.append(f"{module_id}: default_enabled must be boolean")

    modes = module.get("allowed_integration_modes")
    if not isinstance(modes, list) or not modes:
        errors.append(f"{module_id}: allowed_integration_modes must be a non-empty list")
    elif any(mode not in allowed_modes for mode in modes):
        invalid = sorted({mode for mode in modes if mode not in allowed_modes})
        errors.append(f"{module_id}: invalid integration modes: {', '.join(invalid)}")

    dependencies = module.get("external_dependencies")
    if not isinstance(dependencies, list) or any(not _is_non_empty_string(item) for item in dependencies):
        errors.append(f"{module_id}: external_dependencies must be a list of strings")

    learning_access = module.get("learning_access")
    if not isinstance(learning_access, dict):
        errors.append(f"{module_id}: learning_access must be an object")
    else:
        for field in ("read_digest", "write_signals"):
            if not isinstance(learning_access.get(field), bool):
                errors.append(f"{module_id}: learning_access.{field} must be boolean")

    owner_surface = module.get("owner_surface")
    if _is_non_empty_string(owner_surface):
        surface = ROOT / owner_surface
        if not surface.exists():
            errors.append(f"{module_id}: owner_surface does not exist: {owner_surface}")
        elif not (surface / "SKILL.md").exists():
            errors.append(f"{module_id}: owner_surface lacks SKILL.md: {owner_surface}")

    if classification == "native" and dependencies:
        errors.append(f"{module_id}: native modules must not declare external_dependencies")
    if classification == "provider-backed" and not dependencies:
        errors.append(f"{module_id}: provider-backed modules must declare external_dependencies")

    return errors


def main() -> int:
    errors: list[str] = []
    try:
        metadata = _load_json(METADATA_PATH)
    except OSError as exc:
        print(f"[module metadata] failed to read {METADATA_PATH}: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"[module metadata] invalid json in {METADATA_PATH}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(metadata, dict):
        errors.append("metadata root must be an object")
        metadata = {}

    classifications = metadata.get("classifications")
    if not isinstance(classifications, list):
        errors.append("classifications must be a list")
        classifications = []
    allowed_classifications = set(classifications)
    if REQUIRED_CLASSIFICATIONS - allowed_classifications:
        missing = sorted(REQUIRED_CLASSIFICATIONS - allowed_classifications)
        errors.append(f"classifications missing required values: {', '.join(missing)}")

    modes = metadata.get("allowed_integration_modes")
    if not isinstance(modes, list):
        errors.append("allowed_integration_modes must be a list")
        modes = []
    allowed_modes = set(modes)

    modules = metadata.get("modules")
    if not isinstance(modules, list) or not modules:
        errors.append("modules must be a non-empty list")
        modules = []

    seen_ids: set[str] = set()
    for module in modules:
        if not isinstance(module, dict):
            errors.append("each module entry must be an object")
            continue
        module_id = module.get("id")
        if module_id in seen_ids:
            errors.append(f"{module_id}: duplicate module id")
        if isinstance(module_id, str):
            seen_ids.add(module_id)
        errors.extend(_validate_module(module, allowed_classifications, allowed_modes))

    skill_dirs = {
        path.name
        for path in MODULES_ROOT.iterdir()
        if path.is_dir() and (path / "SKILL.md").exists()
    }
    missing_metadata = sorted(skill_dirs - seen_ids)
    if missing_metadata:
        errors.append(f"skill directories missing metadata: {', '.join(missing_metadata)}")

    if errors:
        print("[module metadata] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"[module metadata] ok: {len(modules)} module(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

