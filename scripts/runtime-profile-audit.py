#!/usr/bin/env python3
"""Compare shared ~/.claude runtime settings with repo-dev .claude settings."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path.home() / ".claude"
SHARED_SETTINGS = ROOT / "settings.json"
REPO_DEV_SETTINGS = ROOT / ".claude" / "settings.json"


def load_json(path: Path) -> tuple[dict, bool]:
    if not path.is_file():
        return {}, False
    return json.loads(path.read_text(encoding="utf-8")), True


def hook_commands(settings: dict) -> dict[str, list[str]]:
    commands: dict[str, list[str]] = {}
    for event, entries in (settings.get("hooks") or {}).items():
        bucket: list[str] = []
        for entry in entries or []:
            for hook in entry.get("hooks") or []:
                command = hook.get("command")
                if isinstance(command, str) and command.strip():
                    bucket.append(command.strip())
        if bucket:
            commands[event] = bucket
    return commands


def summarize_profile(name: str, settings: dict, exists: bool) -> dict:
    hooks = hook_commands(settings)
    enabled_plugins = sorted((settings.get("enabledPlugins") or {}).keys())
    marketplaces = sorted((settings.get("extraKnownMarketplaces") or {}).keys())
    return {
        "profile": name,
        "settings_found": exists,
        "hook_events": sorted(hooks.keys()),
        "hook_commands": hooks,
        "enabled_plugins": enabled_plugins,
        "marketplaces": marketplaces,
    }


def overlap(shared: dict, repo_dev: dict) -> dict:
    shared_hooks = hook_commands(shared)
    repo_hooks = hook_commands(repo_dev)
    events = sorted(set(shared_hooks) & set(repo_hooks))
    return {
        "shared_only_events": sorted(set(shared_hooks) - set(repo_hooks)),
        "repo_dev_only_events": sorted(set(repo_hooks) - set(shared_hooks)),
        "overlap_events": events,
        "overlap_hook_commands": {
            event: sorted(set(shared_hooks.get(event, [])) & set(repo_hooks.get(event, [])))
            for event in events
        },
        "shared_only_plugins": sorted(
            set((shared.get("enabledPlugins") or {}).keys()) - set((repo_dev.get("enabledPlugins") or {}).keys())
        ),
        "repo_dev_only_plugins": sorted(
            set((repo_dev.get("enabledPlugins") or {}).keys()) - set((shared.get("enabledPlugins") or {}).keys())
        ),
    }


def main() -> int:
    shared, shared_exists = load_json(SHARED_SETTINGS)
    repo_dev, repo_dev_exists = load_json(REPO_DEV_SETTINGS)

    warnings: list[str] = []
    if not shared_exists:
        warnings.append(f"missing shared settings: {SHARED_SETTINGS}")
    if not repo_dev_exists:
        warnings.append(f"missing repo-dev settings: {REPO_DEV_SETTINGS}")

    report = {
        "shared_profile": summarize_profile("shared", shared, shared_exists),
        "repo_dev_profile": summarize_profile("repo-dev", repo_dev, repo_dev_exists),
        "overlap_summary": overlap(shared, repo_dev),
        "paths": {
            "shared_settings": str(SHARED_SETTINGS),
            "repo_dev_settings": str(REPO_DEV_SETTINGS),
        },
        "warnings": warnings,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
