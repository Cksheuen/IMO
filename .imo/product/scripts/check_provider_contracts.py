#!/usr/bin/env python3
"""Validate IMO provider registry contracts."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = ROOT / ".imo/providers/registry.json"
REQUIRED_HEALTH_STATES = {"not_installed", "unavailable", "degraded", "ok"}
REQUIRED_CATEGORIES = {
    "task-provider",
    "plugin-provider",
    "skill-provider",
    "runtime-provider",
    "imo-native-provider",
}


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) and item for item in value)


def _validate_provider(provider: dict[str, Any], categories: set[str], health_states: set[str]) -> list[str]:
    errors: list[str] = []
    provider_id = provider.get("id", "<missing-id>")
    for field in ("id", "name", "category", "ownership", "discovery", "invocation", "health"):
        if field not in provider:
            errors.append(f"{provider_id}: missing {field}")

    if provider.get("category") not in categories:
        errors.append(f"{provider_id}: invalid category {provider.get('category')!r}")

    ownership = provider.get("ownership")
    if not isinstance(ownership, dict):
        errors.append(f"{provider_id}: ownership must be an object")
        ownership = {}
    if not isinstance(ownership.get("owned_by_imo"), bool):
        errors.append(f"{provider_id}: ownership.owned_by_imo must be boolean")
    if ownership.get("source_policy") == "vendored":
        errors.append(f"{provider_id}: provider source must not be vendored by default")

    discovery = provider.get("discovery")
    if not isinstance(discovery, dict):
        errors.append(f"{provider_id}: discovery must be an object")
        discovery = {}
    if discovery.get("read_only") is not True:
        errors.append(f"{provider_id}: discovery.read_only must be true")
    if not _string_list(discovery.get("inputs")):
        errors.append(f"{provider_id}: discovery.inputs must be a list of strings")

    invocation = provider.get("invocation")
    if not isinstance(invocation, dict):
        errors.append(f"{provider_id}: invocation must be an object")
        invocation = {}
    if invocation.get("default_enabled") is not False:
        errors.append(f"{provider_id}: invocation.default_enabled must be false")
    if invocation.get("requires_explicit_task") is not True:
        errors.append(f"{provider_id}: invocation.requires_explicit_task must be true")

    health = provider.get("health")
    if not isinstance(health, dict):
        errors.append(f"{provider_id}: health must be an object")
        health = {}
    if health.get("default_status") not in health_states:
        errors.append(f"{provider_id}: invalid health.default_status {health.get('default_status')!r}")
    if not isinstance(health.get("missing_is_failure"), bool):
        errors.append(f"{provider_id}: health.missing_is_failure must be boolean")

    if ownership.get("owned_by_imo") is False and health.get("default_status") == "ok":
        errors.append(f"{provider_id}: external providers must not default to ok")

    return errors


def main() -> int:
    errors: list[str] = []
    try:
        registry = _load_json(REGISTRY_PATH)
    except OSError as exc:
        print(f"[provider contracts] failed to read {REGISTRY_PATH}: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"[provider contracts] invalid json in {REGISTRY_PATH}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(registry, dict):
        errors.append("registry root must be an object")
        registry = {}

    defaults = registry.get("defaults")
    if not isinstance(defaults, dict):
        errors.append("defaults must be an object")
        defaults = {}
    if defaults.get("discovery_read_only") is not True:
        errors.append("defaults.discovery_read_only must be true")
    if defaults.get("invocation_enabled") is not False:
        errors.append("defaults.invocation_enabled must be false")
    if defaults.get("external_source_policy") != "do-not-vendor-by-default":
        errors.append("defaults.external_source_policy must be do-not-vendor-by-default")

    categories = registry.get("categories")
    if not isinstance(categories, list):
        errors.append("categories must be a list")
        categories = []
    category_set = set(categories)
    if REQUIRED_CATEGORIES - category_set:
        errors.append(f"missing categories: {', '.join(sorted(REQUIRED_CATEGORIES - category_set))}")

    health_states = registry.get("health_states")
    if not isinstance(health_states, list):
        errors.append("health_states must be a list")
        health_states = []
    health_set = set(health_states)
    if REQUIRED_HEALTH_STATES - health_set:
        errors.append(f"missing health states: {', '.join(sorted(REQUIRED_HEALTH_STATES - health_set))}")

    providers = registry.get("providers")
    if not isinstance(providers, list) or not providers:
        errors.append("providers must be a non-empty list")
        providers = []

    seen: set[str] = set()
    for provider in providers:
        if not isinstance(provider, dict):
            errors.append("provider entries must be objects")
            continue
        provider_id = provider.get("id")
        if provider_id in seen:
            errors.append(f"{provider_id}: duplicate provider id")
        if isinstance(provider_id, str):
            seen.add(provider_id)
        errors.extend(_validate_provider(provider, category_set, health_set))

    if errors:
        print("[provider contracts] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"[provider contracts] ok: {len(providers)} provider(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

