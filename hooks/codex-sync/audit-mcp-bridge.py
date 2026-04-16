#!/usr/bin/env python3
"""Audit CC-visible MCP servers against the generated Codex bridge."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import tomllib
from collections import OrderedDict
from pathlib import Path
from typing import Any


ROOT = Path.home() / ".claude"
SETTINGS_PATHS = [
    ROOT / "settings.json",
    ROOT / "settings.local.json",
    ROOT / ".claude" / "settings.json",
    ROOT / ".claude" / "settings.local.json",
]
PROJECT_MCP_PATH = ROOT / ".mcp.json"
CODEX_CONFIG_PATH = ROOT / ".codex" / "config.toml"
INSTALLED_PLUGINS_PATH = ROOT / "plugins" / "installed_plugins.json"


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def load_settings_layers() -> list[tuple[str, dict[str, Any]]]:
    layers: list[tuple[str, dict[str, Any]]] = []
    for path in SETTINGS_PATHS:
        if path.exists():
            layers.append((str(path), load_json(path)))
    return layers


def normalize_mcp_root(data: dict[str, Any]) -> OrderedDict[str, dict[str, Any]]:
    root = data.get("mcpServers", data)
    if not isinstance(root, dict):
        return OrderedDict()
    result: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for name, config in root.items():
        if isinstance(config, dict):
            result[name] = config
    return result


def enabled_plugin_refs(settings_layers: list[tuple[str, dict[str, Any]]]) -> list[str]:
    refs: OrderedDict[str, None] = OrderedDict()
    for _, data in settings_layers:
        enabled_plugins = data.get("enabledPlugins")
        if not isinstance(enabled_plugins, dict):
            continue
        for plugin_ref, enabled in enabled_plugins.items():
            if enabled and isinstance(plugin_ref, str) and "@" in plugin_ref:
                refs[plugin_ref] = None
    return list(refs.keys())


def plugin_install_paths(plugin_refs: list[str]) -> dict[str, Path]:
    installed = load_json(INSTALLED_PLUGINS_PATH).get("plugins")
    if not isinstance(installed, dict):
        return {}
    result: dict[str, Path] = {}
    for plugin_ref in plugin_refs:
        entries = installed.get(plugin_ref)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("installPath"), str):
                result[plugin_ref] = Path(entry["installPath"])
                break
    return result


def plugin_mcp_candidate_paths(plugin_ref: str) -> list[Path]:
    plugin_name, marketplace = plugin_ref.split("@", 1)
    marketplace_root = ROOT / "plugins" / "marketplaces" / marketplace
    return [
        marketplace_root / ".mcp.json",
        marketplace_root / plugin_name / ".mcp.json",
        marketplace_root / "plugin" / ".mcp.json",
        marketplace_root / "plugins" / plugin_name / ".mcp.json",
        marketplace_root / "external_plugins" / plugin_name / ".mcp.json",
    ]


def replace_plugin_root(value: Any, plugin_root: Path) -> Any:
    if isinstance(value, str):
        return value.replace("${CLAUDE_PLUGIN_ROOT}", str(plugin_root))
    if isinstance(value, list):
        return [replace_plugin_root(item, plugin_root) for item in value]
    if isinstance(value, dict):
        return {key: replace_plugin_root(item, plugin_root) for key, item in value.items()}
    return value


def load_plugin_servers(plugin_refs: list[str]) -> tuple[OrderedDict[str, dict[str, Any]], dict[str, str]]:
    servers: OrderedDict[str, dict[str, Any]] = OrderedDict()
    sources: dict[str, str] = {}
    install_paths = plugin_install_paths(plugin_refs)

    for plugin_ref in plugin_refs:
        plugin_root = install_paths.get(plugin_ref)
        candidate_paths: list[Path] = []
        if plugin_root:
            candidate_paths.append(plugin_root / ".mcp.json")
        candidate_paths.extend(plugin_mcp_candidate_paths(plugin_ref))

        for path in candidate_paths:
            data = load_json(path)
            if not data:
                continue
            resolved_root = plugin_root if plugin_root and path.parent == plugin_root else path.parent
            for name, config in normalize_mcp_root(data).items():
                servers[name] = replace_plugin_root(config, resolved_root)
                sources[name] = f"plugin:{plugin_ref}:{path}"
            break
    return servers, sources


def load_settings_servers(
    settings_layers: list[tuple[str, dict[str, Any]]]
) -> tuple[OrderedDict[str, dict[str, Any]], dict[str, str]]:
    servers: OrderedDict[str, dict[str, Any]] = OrderedDict()
    sources: dict[str, str] = {}
    for path, data in settings_layers:
        for name, config in normalize_mcp_root({"mcpServers": data.get("mcpServers", {})}).items():
            servers[name] = config
            sources[name] = f"settings:{path}"
    return servers, sources


def project_mcp_policy(settings_layers: list[tuple[str, dict[str, Any]]]) -> tuple[bool, set[str]]:
    enable_all = False
    enabled_subset: set[str] = set()
    for _, data in settings_layers:
        if "enableAllProjectMcpServers" in data:
            enable_all = bool(data.get("enableAllProjectMcpServers"))
        value = data.get("enabledMcpjsonServers")
        if isinstance(value, list):
            enabled_subset = {item for item in value if isinstance(item, str)}
    return enable_all, enabled_subset


def load_project_servers(
    settings_layers: list[tuple[str, dict[str, Any]]]
) -> tuple[OrderedDict[str, dict[str, Any]], dict[str, str]]:
    data = load_json(PROJECT_MCP_PATH)
    enable_all, enabled_subset = project_mcp_policy(settings_layers)
    servers: OrderedDict[str, dict[str, Any]] = OrderedDict()
    sources: dict[str, str] = {}
    for name, config in normalize_mcp_root(data).items():
        if enable_all or not enabled_subset or name in enabled_subset:
            servers[name] = config
            sources[name] = f"project:{PROJECT_MCP_PATH}"
    return servers, sources


def permission_hint_names(settings_layers: list[tuple[str, dict[str, Any]]]) -> list[str]:
    names: OrderedDict[str, None] = OrderedDict()
    for _, data in settings_layers:
        permissions = data.get("permissions")
        allow = permissions.get("allow") if isinstance(permissions, dict) else None
        if not isinstance(allow, list):
            continue
        for item in allow:
            if not isinstance(item, str) or not item.startswith("mcp__"):
                continue
            name = item[len("mcp__") :].split("__", 1)[0].strip()
            if name:
                names[name] = None
    return list(names.keys())


def parse_claude_mcp_get_output(output: str) -> dict[str, Any] | None:
    config: dict[str, Any] = {}
    in_env = False
    for raw_line in output.splitlines():
        line = raw_line.rstrip()
        if not line.startswith("  "):
            continue
        stripped = line.strip()
        if in_env and ":" in stripped:
            key, value = stripped.split(":", 1)
            config.setdefault("env", {})[key.strip()] = value.strip()
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        in_env = key == "environment"
        if key == "type":
            config["type"] = value
        elif key == "command" and value:
            config["command"] = value
        elif key == "args":
            config["args"] = shlex.split(value) if value else []
        elif key == "url" and value:
            config["url"] = value
    return config or None


def load_permission_servers(names: list[str]) -> tuple[OrderedDict[str, dict[str, Any]], dict[str, str]]:
    servers: OrderedDict[str, dict[str, Any]] = OrderedDict()
    sources: dict[str, str] = {}
    for name in names:
        try:
            result = subprocess.run(
                ["claude", "mcp", "get", name],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode != 0:
            continue
        parsed = parse_claude_mcp_get_output(result.stdout)
        if parsed:
            servers[name] = parsed
            sources[name] = "claude mcp get"
    return servers, sources


def expected_cc_servers() -> tuple[OrderedDict[str, dict[str, Any]], dict[str, str]]:
    settings_layers = load_settings_layers()
    plugin_refs = enabled_plugin_refs(settings_layers)

    merged: OrderedDict[str, dict[str, Any]] = OrderedDict()
    sources: dict[str, str] = {}

    for bucket, bucket_sources in (
        load_plugin_servers(plugin_refs),
        load_settings_servers(settings_layers),
        load_project_servers(settings_layers),
        load_permission_servers(permission_hint_names(settings_layers)),
    ):
        for name, config in bucket.items():
            merged[name] = config
        sources.update(bucket_sources)

    return merged, sources


def load_codex_servers() -> OrderedDict[str, dict[str, Any]]:
    if not CODEX_CONFIG_PATH.exists():
        return OrderedDict()
    try:
        data = tomllib.loads(CODEX_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return OrderedDict()
    root = data.get("mcp_servers")
    if not isinstance(root, dict):
        return OrderedDict()
    result: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for name, config in root.items():
        if isinstance(config, dict):
            result[name] = config
    return result


def build_report() -> dict[str, Any]:
    cc_servers, cc_sources = expected_cc_servers()
    codex_servers = load_codex_servers()

    cc_names = list(cc_servers.keys())
    codex_names = list(codex_servers.keys())
    cc_set = set(cc_names)
    codex_set = set(codex_names)

    return {
        "paths": {
            "codex_config": str(CODEX_CONFIG_PATH),
            "project_mcp": str(PROJECT_MCP_PATH),
            "settings_layers": [path for path, _ in load_settings_layers()],
        },
        "cc_visible_servers": cc_names,
        "codex_bridged_servers": codex_names,
        "cc_only": sorted(cc_set - codex_set),
        "codex_only": sorted(codex_set - cc_set),
        "source_by_server": {name: cc_sources.get(name, "unknown") for name in cc_names},
        "ok": sorted(cc_set & codex_set),
    }


def print_text(report: dict[str, Any]) -> None:
    print("MCP bridge audit")
    print(f"- Codex config: {report['paths']['codex_config']}")
    print(f"- CC visible: {', '.join(report['cc_visible_servers']) or '(none)'}")
    print(f"- Codex bridged: {', '.join(report['codex_bridged_servers']) or '(none)'}")
    print(f"- 差集 CC→Codex: {', '.join(report['cc_only']) or '(none)'}")
    print(f"- 差集 Codex-only: {', '.join(report['codex_only']) or '(none)'}")
    if report["source_by_server"]:
        print("- 来源:")
        for name, source in report["source_by_server"].items():
            print(f"  - {name}: {source}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit CC MCP visibility vs Codex bridge.")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = build_report()
    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
