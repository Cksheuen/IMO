#!/usr/bin/env python3
"""Install IMO global context hooks and skill projections for both hosts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any

import global_claude
import global_codex_instructions
import root_resolver


SOURCE_ROOT = Path(__file__).resolve().parents[3]
HOOK_REL = Path("hooks/codex-context.sh")
MANIFEST_REL = Path("install/managed-hashes.json")
MODULES_PATH = SOURCE_ROOT / ".imo/product/skills/modules.json"
CODEX_HOOKS_REL = Path("hooks.json")
CODEX_AGENTS_REL = Path("install/codex/AGENTS.md")
CODEX_OWNERSHIP_REL = Path("install/codex/ownership.json")
CODEX_AGENTS_LINK_REL = Path("AGENTS.md")
WORKER_REL = Path("imo-worker.config.toml")
WORKER_TEXT = """# Lean startup for delegated Codex workers: codex --profile imo-worker
# Layers on top of config.toml; the user's own sessions are unchanged.
[features]
memories = false
multi_agent = false
plugins = false
remote_plugin = false
apps = false

[skills]
max_context_tokens = 1
"""
WORKER_SETTINGS = {
    "features": {"memories": False, "multi_agent": False, "plugins": False,
                 "remote_plugin": False, "apps": False},
    "skills": {"max_context_tokens": 1},
}
WORKER_KEY = "codex/" + WORKER_REL.as_posix()


def _worker_values(path: Path) -> dict[str, dict[str, Any]]:
    """Read only IMO's keys: Codex writes its own state (e.g. [tui.*]) into the active profile."""
    values: dict[str, dict[str, Any]] = {table: {} for table in WORKER_SETTINGS}
    table = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line.startswith("[") and line.endswith("]"):
            table = line.strip("[]").strip()
        elif "=" in line and table in WORKER_SETTINGS:
            key, value = (part.strip() for part in line.split("=", 1))
            if key in WORKER_SETTINGS[table]:
                values[table][key] = {"true": True, "false": False}.get(
                    value, int(value) if value.isdigit() else value)
    return values


def _worker_state(path: Path, manifest: dict[str, Any]) -> str:
    if not path.exists() and not path.is_symlink():
        return "missing"
    try:
        values = _worker_values(path)
    except (OSError, UnicodeDecodeError):
        return "conflict"
    entry = manifest.get("files", {}).get(WORKER_KEY) if isinstance(manifest.get("files"), dict) else None
    recorded = entry.get("settings") if isinstance(entry, dict) else None
    return "present" if values == WORKER_SETTINGS else "modified" if values == recorded else "conflict"


def _hook_text(source_root: Path = SOURCE_ROOT) -> str:
    return """#!/usr/bin/env bash
set -euo pipefail

find_local_hook_file() {
  local dir="${PWD}"
  while true; do
    if [[ -f "${dir}/.codex/hooks.json" ]]; then
      printf '%s\\n' "${dir}/.codex/hooks.json"
      return 0
    fi
    if [[ "${dir}" == "/" ]]; then
      return 1
    fi
    dir="$(dirname "${dir}")"
  done
}

local_hook_file="$(find_local_hook_file || true)"
if [[ -n "${local_hook_file}" ]] && grep -q "imo codex context" "${local_hook_file}"; then
  exit 0
fi

if command -v imo >/dev/null 2>&1; then
  exec imo codex context --event SessionStart
fi

if [[ -x "__IMO_SOURCE_ROOT__/imo" ]]; then
  exec "__IMO_SOURCE_ROOT__/imo" codex context --event SessionStart
fi

exit 0
""".replace("__IMO_SOURCE_ROOT__", str(source_root))


def _codex_ownership_text(global_root: Path, codex_root: Path) -> str:
    return json.dumps(
        {
            "schema_version": 1,
            "owner": "imo",
            "scope": "codex-global-host-surfaces",
            "global_root": str(global_root),
            "codex_root": str(codex_root),
            "managed_surfaces": ["AGENTS.md", "hooks.json", "skills/", "imo-worker.config.toml"],
        },
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def _hash_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _file_hash(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _entry_hash(path: Path) -> str | None:
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink():
        return "symlink:" + os.readlink(path)
    if path.is_file():
        return _file_hash(path)
    return "directory"


def _managed_file_state(path: Path, desired_hash: str, manifest_hash: str | None) -> str:
    current = _entry_hash(path)
    return "missing" if current is None else "present" if current == desired_hash else "modified" if manifest_hash is not None and current == manifest_hash else "conflict"


def _manifest_file_hash(manifest: dict[str, Any], relative: Path) -> str | None:
    files = manifest.get("files")
    if not isinstance(files, dict):
        return None
    entry = files.get(relative.as_posix())
    if not isinstance(entry, dict):
        return None
    file_hash = entry.get("hash")
    if not isinstance(file_hash, str):
        return None
    return file_hash


def _global_root(args: argparse.Namespace) -> Path:
    return Path(args.global_root).expanduser().resolve() if args.global_root else root_resolver.resolve_global_root()


def _load_manifest(global_root: Path) -> dict[str, Any]:
    manifest_path = global_root / MANIFEST_REL
    if not manifest_path.is_file():
        return {}
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_modules() -> list[dict[str, str]]:
    data = json.loads(MODULES_PATH.read_text(encoding="utf-8"))
    modules = data.get("modules", []) if isinstance(data, dict) else []
    result: list[dict[str, str]] = []
    for module in modules:
        if not isinstance(module, dict) or module.get("default_enabled") is not True:
            continue
        name = module.get("name")
        owner = module.get("owner_surface")
        if isinstance(name, str) and isinstance(owner, str):
            result.append({"name": name, "owner_surface": owner})
    return result


def _source_mode() -> str:
    return "linked-checkout" if (SOURCE_ROOT / ".git").exists() else "package"


def _load_hook_settings(path: Path) -> dict[str, Any]:
    if not path.exists() and not path.is_symlink():
        return {"hooks": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Hook settings root must be an object")
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("Hook settings field must be an object")
    return data


def _commands(entries):
    return [hook.get("command") for entry in entries if isinstance(entry, dict)
            for hook in entry.get("hooks", []) if isinstance(hook, dict)]


def _hook_registration_state(hooks_path, desired_command, manifest_command):
    if not hooks_path.exists():
        return "missing"
    try:
        hooks = _load_hook_settings(hooks_path)["hooks"]
        session = hooks.get("SessionStart", [])
        prompt = hooks.get("UserPromptSubmit", [])
        if not isinstance(session, list) or not isinstance(prompt, list):
            return "conflict"
        if desired_command in _commands(prompt) or (manifest_command and manifest_command in _commands(prompt)):
            return "stale"
        if desired_command in _commands(session):
            return "present"
        return "stale" if session else "missing"
    except (OSError, ValueError, TypeError):
        return "conflict"


def _stale_skills(skill_root):
    current = {module["name"] for module in _load_modules()}
    source = (SOURCE_ROOT / ".imo/product/skills").resolve()
    if not skill_root.is_dir():
        return []
    return [path for path in skill_root.iterdir() if path.name not in current
            and path.is_symlink() and _resolved_link(path).is_relative_to(source)]


def _skill_projection_state(skill_root: Path, manifest: dict[str, Any]) -> tuple[str, int, int]:
    del manifest

    modules = _load_modules()
    total = len(modules)
    present_count = 0
    conflict = False
    modified = False
    any_path = False

    for module in modules:
        link = skill_root / module["name"]
        desired = (SOURCE_ROOT / module["owner_surface"]).resolve(strict=False)
        any_path = any_path or link.is_symlink() or link.exists()

        if link.is_symlink():
            if _resolved_link(link) == desired:
                present_count += 1
            else:
                modified = True
        elif link.exists():
            conflict = True

    if _stale_skills(skill_root):
        state = "stale"
    elif conflict:
        state = "conflict"
    elif modified:
        state = "modified"
    elif present_count == total:
        state = "present"
    elif present_count == 0 and not any_path:
        state = "missing"
    else:
        state = "stale"

    return state, present_count, total


def _write_hook_settings(path: Path, data: dict[str, Any]) -> None:
    # Write through a symlinked settings file instead of replacing the link.
    path = path.resolve() if path.is_symlink() else path
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".imo-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _edit_hook_registration(path, command, *, install):
    data = _load_hook_settings(path)
    for event in ("SessionStart", "UserPromptSubmit"):
        entries = data["hooks"].get(event, [])
        if not isinstance(entries, list):
            raise ValueError(f"{event} hooks must be a list")
        kept = []
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("hooks"), list):
                remaining = [hook for hook in entry["hooks"]
                             if not (isinstance(hook, dict) and hook.get("command") == command)]
                if len(remaining) != len(entry["hooks"]):
                    if remaining:
                        kept.append({**entry, "hooks": remaining})
                    continue
            kept.append(entry)
        if kept != entries:
            if kept:
                data["hooks"][event] = kept
            else:
                data["hooks"].pop(event, None)
    if install:
        data["hooks"].setdefault("SessionStart", []).append(
            {"hooks": [{"type": "command", "command": command, "timeout": 5}]})
    _write_hook_settings(path, data)


def _symlink_metadata(path: Path) -> dict[str, str] | None:
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink():
        return {"kind": "symlink", "target": os.readlink(path)}
    return {"kind": "unmanaged"}


def _resolved_link(path: Path) -> Path | None:
    if not path.is_symlink():
        return None
    target = Path(os.readlink(path))
    if not target.is_absolute():
        target = path.parent / target
    return target.resolve(strict=False)


def _skill_conflicts(skill_root: Path, old_skills: dict[str, Any]) -> list[Path]:
    conflicts: list[Path] = []
    if not isinstance(old_skills, dict):
        old_skills = {}
    for module in _load_modules():
        name = module["name"]
        path = skill_root / name
        desired = (SOURCE_ROOT / module["owner_surface"]).resolve(strict=False)
        current = _resolved_link(path)
        old = old_skills.get(name)
        old_target = Path(old.get("target")).resolve(strict=False) if isinstance(old, dict) and isinstance(old.get("target"), str) else None
        if not path.exists() and not path.is_symlink():
            continue
        if current is not None and current in {desired, old_target}:
            continue
        conflicts.append(path)
    return conflicts


def _install_skill_links(skill_root: Path, old_skills: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(old_skills, dict):
        old_skills = {}
    skill_root.mkdir(parents=True, exist_ok=True)
    names = {module["name"] for module in _load_modules()}
    retired = {name: entry for name, entry in old_skills.items() if name not in names
               and isinstance(entry, dict) and isinstance(entry.get("target"), str)
               and (skill_root / name).is_symlink()
               and _resolved_link(skill_root / name) == Path(entry["target"]).resolve(strict=False)}
    _restore_skill_links(skill_root, retired, force=False)
    installed: dict[str, Any] = {}
    for module in _load_modules():
        name = module["name"]
        path = skill_root / name
        desired = (SOURCE_ROOT / module["owner_surface"]).resolve(strict=False)
        old = old_skills.get(name)
        previous = old.get("previous") if isinstance(old, dict) else _symlink_metadata(path)
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.exists():
            raise IsADirectoryError(f"cannot replace unmanaged skill directory: {path}")
        os.symlink(str(desired), path)
        installed[name] = {
            "path": str(path),
            "target": str(desired),
            "previous": previous,
        }
    return installed


def _restore_skill_links(skill_root: Path, skills: dict[str, Any], *, force: bool) -> list[Path]:
    conflicts: list[Path] = []
    if not isinstance(skills, dict):
        return conflicts
    for name, metadata in skills.items():
        if not isinstance(metadata, dict):
            continue
        path = skill_root / name
        target = metadata.get("target")
        current = _resolved_link(path)
        expected = Path(target).resolve(strict=False) if isinstance(target, str) else None
        if (path.exists() or path.is_symlink()) and current != expected and not force:
            conflicts.append(path)
            continue
        if path.is_symlink() or path.is_file():
            path.unlink()
        previous = metadata.get("previous")
        if isinstance(previous, dict) and previous.get("kind") == "symlink" and isinstance(previous.get("target"), str):
            path.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(previous["target"], path)
    return conflicts


def _write_manifest(global_root: Path, payload: dict[str, Any]) -> None:
    path = global_root / MANIFEST_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _print_diagnostic(title: str, payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return

    print(title)

    for name in sorted(payload.get("states", {})):
        print(f"{name}: {payload['states'][name]}")

    for host in payload.get("hosts", []):
        print(f"{host}_skill_projections: {payload[host + '_skill_projections']}/{payload[host + '_skill_expected']}")
    for key in ("global_root", "codex_root", "claude_home", "source_root", "source_mode", "project_root"):
        if key in payload:
            print(f"{key}: {payload[key]}")

    issues = payload.get("issues", [])
    print(f"issues: {', '.join(issues) if issues else 'none'}")

    print(f"healthy: {'yes' if payload.get('healthy') else 'no'}")


def _targets(args, manifest):
    selected = args.host or ("both" if args.command in {"install", "migrate"} else None)
    hosts = ["codex", "claude"] if selected == "both" else [selected] if selected else manifest.get("hosts", ["codex"])
    codex = Path(args.codex_root or manifest.get("codex_root") or os.environ.get("CODEX_HOME") or "~/.codex").expanduser().resolve()
    claude = global_claude.home(args.claude_home or manifest.get("claude_home"))
    root = _global_root(args)
    surfaces = {
        "codex": {"root": codex, "hook": root / HOOK_REL, "hook_rel": HOOK_REL,
                  "text": _hook_text(), "settings": codex / CODEX_HOOKS_REL},
        "claude": global_claude.surfaces(root, claude, SOURCE_ROOT),
    }
    return {host: surfaces[host] for host in hosts}


def _managed_surfaces(global_root, targets):
    result = {}
    for host, surface in targets.items():
        result[surface["hook_rel"].as_posix()] = (surface["hook"], surface["text"], host)
        if host == "codex":
            result[CODEX_OWNERSHIP_REL.as_posix()] = (
                global_root / CODEX_OWNERSHIP_REL,
                _codex_ownership_text(global_root, surface["root"]), host)
    return result


def _diagnose_args(args):
    root = _global_root(args)
    manifest = _load_manifest(root)
    targets = _targets(args, manifest)
    states = {"manifest": "present" if manifest else "conflict" if (root / MANIFEST_REL).exists() else "missing"}
    if manifest and (manifest.get("source_root") != str(SOURCE_ROOT)
                     or manifest.get("global_root") != str(root)
                     or manifest.get("source_mode") != _source_mode()):
        states["manifest"] = "stale"
    payload = {"global_root": str(root), "source_root": str(SOURCE_ROOT),
               "source_mode": _source_mode(), "hosts": list(targets),
               "project_root": str(root_resolver.resolve_project_root() or "not detected")}
    extra_issues = []
    for host, surface in targets.items():
        host_root = surface["root"]
        root_key = "codex_root" if host == "codex" else "claude_home"
        payload[root_key] = str(host_root)
        if manifest and (host not in manifest.get("hosts", ["codex"]) or manifest.get(root_key) != str(host_root)):
            states["manifest"] = "stale"
        states[host + "_context_hook"] = _managed_file_state(
            surface["hook"], _hash_text(surface["text"]), _manifest_file_hash(manifest, surface["hook_rel"]))
        recorded = manifest.get(host + "_hooks")
        states[host + "_hook_registration"] = _hook_registration_state(
            surface["settings"], str(surface["hook"]), recorded.get("command") if isinstance(recorded, dict) else None)
        state, count, total = _skill_projection_state(host_root / "skills", manifest)
        states[host + "_skill_projections"] = state
        payload[host + "_skill_projections"] = count
        payload[host + "_skill_expected"] = total
        extra_issues.extend(str(path) for path in _stale_skills(host_root / "skills"))
        if host == "codex":
            states["codex_instructions"] = global_codex_instructions.instructions_state(
                root / CODEX_AGENTS_REL, host_root / CODEX_AGENTS_LINK_REL, SOURCE_ROOT, manifest, CODEX_AGENTS_REL)
            states["codex_worker_profile"] = _worker_state(host_root / WORKER_REL, manifest)
            states["codex_ownership_marker"] = _managed_file_state(
                root / CODEX_OWNERSHIP_REL, _hash_text(_codex_ownership_text(root, host_root)),
                _manifest_file_hash(manifest, CODEX_OWNERSHIP_REL))
    issues = sorted([key for key, value in states.items() if value != "present"] + extra_issues)
    return {**payload, "states": states, "issues": issues, "healthy": not issues}


def _status(args):
    _print_diagnostic("IMO global status", _diagnose_args(args), bool(args.json))
    return 0


def _doctor(args):
    payload = _diagnose_args(args)
    _print_diagnostic("IMO global doctor", payload, bool(args.json))
    return 0 if payload["healthy"] else 1


def _preflight_settings(path):
    data = _load_hook_settings(path)
    for event in ("SessionStart", "UserPromptSubmit"):
        if not isinstance(data["hooks"].get(event, []), list):
            raise ValueError(f"{path}: {event} hooks must be a list")


def _install(args):
    root = _global_root(args)
    old = _load_manifest(root)
    targets = _targets(args, old)
    managed = _managed_surfaces(root, targets)
    print(f"[imo global] install {'apply' if args.apply else 'dry-run'}: {root}")
    print(f"[imo global] source: {SOURCE_ROOT} ({_source_mode()})")
    for host, surface in targets.items():
        extra = ", AGENTS.md, imo-worker profile" if host == "codex" else ""
        print(f"[imo global] {host}: {surface['root']} -> {len(_load_modules())} skill links, "
              f"SessionStart hook in {surface['settings'].name}{extra}")
    try:
        for key, (path, text, host) in managed.items():
            if _entry_hash(path) not in {None, _hash_text(text), _manifest_file_hash(old, Path(key))} and not args.force:
                raise ValueError(f"refused to overwrite unmanaged file: {path}")
        for host, surface in targets.items():
            host_root = surface["root"]
            _preflight_settings(surface["settings"])
            conflicts = _skill_conflicts(host_root / "skills", old.get(host + "_skills", {}))
            if conflicts and not args.force:
                raise ValueError("refused unmanaged skill paths: " + ", ".join(map(str, conflicts)))
            if any(path.is_dir() and not path.is_symlink() for path in conflicts):
                raise ValueError("refused to replace unmanaged skill directories")
            if host == "codex" and not args.force:
                if _worker_state(host_root / WORKER_REL, old) == "conflict":
                    raise ValueError(f"refused to overwrite unmanaged file: {host_root / WORKER_REL}")
                if global_codex_instructions.file_conflict(root / CODEX_AGENTS_REL, SOURCE_ROOT, old, CODEX_AGENTS_REL):
                    raise ValueError(f"refused to overwrite unmanaged file: {root / CODEX_AGENTS_REL}")
                if global_codex_instructions.link_conflict(host_root / CODEX_AGENTS_LINK_REL, root / CODEX_AGENTS_REL, old):
                    raise ValueError("refused unmanaged Codex AGENTS path")
        if not args.apply:
            print("[imo global] pass --apply to write managed global files")
            return 0
        payload = dict(old)
        files = dict(old.get("files", {}))
        for key, (path, text, host) in managed.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.is_symlink():
                path.unlink()
            path.write_text(text, encoding="utf-8")
            if path == targets[host]["hook"]:
                path.chmod(0o755)
            files[key] = {"kind": "file", "hash": _hash_text(text), "host": host}
        for host, surface in targets.items():
            host_root = surface["root"]
            payload["codex_root" if host == "codex" else "claude_home"] = str(host_root)
            payload[host + "_skills"] = _install_skill_links(host_root / "skills", old.get(host + "_skills", {}))
            _edit_hook_registration(surface["settings"], str(surface["hook"]), install=True)
            payload[host + "_hooks"] = {"path": str(surface["settings"]), "event": "SessionStart", "command": str(surface["hook"])}
            if host == "codex":
                agents = root / CODEX_AGENTS_REL
                payload["codex_agents"] = global_codex_instructions.install_agents(
                    agents, host_root / CODEX_AGENTS_LINK_REL, SOURCE_ROOT, old, CODEX_AGENTS_REL, force=bool(args.force))
                files[CODEX_AGENTS_REL.as_posix()] = {"kind": "file", "hash": _file_hash(agents),
                    "managed_hash": global_codex_instructions.managed_hash(SOURCE_ROOT), "host": host}
                payload["codex_ownership"] = {"path": str(root / CODEX_OWNERSHIP_REL), "owner": "imo"}
                profile = host_root / WORKER_REL
                if _worker_state(profile, old) != "present":
                    if profile.is_symlink():
                        profile.unlink()
                    profile.write_text(WORKER_TEXT, encoding="utf-8")
                files[WORKER_KEY] = {"kind": "settings", "settings": WORKER_SETTINGS, "host": host}
        payload.update(schema_version=5, install_mode="global-first", global_root=str(root),
                       source_root=str(SOURCE_ROOT), source_mode=_source_mode(), files=files,
                       managed_files=list(files), hosts=sorted(set(old.get("hosts", ["codex"] if old else [])) | set(targets)))
        _write_manifest(root, payload)
    except (OSError, ValueError) as exc:
        print(f"[imo global] {exc}", file=sys.stderr)
        return 1
    print("[imo global] install complete")
    return 0


def _uninstall(args):
    root = _global_root(args)
    manifest = _load_manifest(root)
    targets = _targets(args, manifest)
    managed = _managed_surfaces(root, targets)
    if "codex" in targets:
        managed[CODEX_AGENTS_REL.as_posix()] = (root / CODEX_AGENTS_REL, "", "codex")
    print(f"[imo global] uninstall {'apply' if args.apply else 'dry-run'}: {root}")
    try:
        for key, (path, text, host) in managed.items():
            current = _entry_hash(path)
            if current not in {None, _manifest_file_hash(manifest, Path(key))} and not args.force:
                raise ValueError(f"refused to remove unmanaged file: {path}")
        for host, surface in targets.items():
            _preflight_settings(surface["settings"])
            if host == "codex" and _worker_state(surface["root"] / WORKER_REL, manifest) == "conflict" and not args.force:
                raise ValueError(f"refused to remove unmanaged file: {surface['root'] / WORKER_REL}")
        if not args.apply:
            print("[imo global] pass --apply to remove managed global files")
            return 0
        for host, surface in targets.items():
            if host == "codex":
                conflicts = global_codex_instructions.restore_agents(surface["root"] / CODEX_AGENTS_LINK_REL, manifest, force=bool(args.force))
                if conflicts:
                    raise ValueError(f"kept modified Codex AGENTS paths: {conflicts}")
            conflicts = _restore_skill_links(surface["root"] / "skills", manifest.get(host + "_skills", {}), force=bool(args.force))
            if conflicts:
                raise ValueError(f"kept modified skill paths: {conflicts}")
            if surface["settings"].exists():
                _edit_hook_registration(surface["settings"], str(surface["hook"]), install=False)
        files = dict(manifest.get("files", {}))
        if "codex" in targets:
            # The profile is removed only while IMO's keys are unchanged, even with --force.
            profile = targets["codex"]["root"] / WORKER_REL
            if _worker_state(profile, manifest) in {"present", "modified"}:
                profile.unlink()
            files.pop(WORKER_KEY, None)
        for key, (path, text, host) in managed.items():
            external = global_codex_instructions.external_content(path) if key == CODEX_AGENTS_REL.as_posix() else ""
            if external.strip():
                path.write_text(external, encoding="utf-8")
            elif path.exists() or path.is_symlink():
                path.unlink()
            files.pop(key, None)
        remaining = set(manifest.get("hosts", ["codex"])) - set(targets)
        if remaining:
            manifest.update(hosts=sorted(remaining), files=files, managed_files=list(files))
            for host in targets:
                for suffix in ("_skills", "_hooks", "_agents", "_ownership"):
                    manifest.pop(host + suffix, None)
            _write_manifest(root, manifest)
        elif (root / MANIFEST_REL).exists():
            (root / MANIFEST_REL).unlink()
    except (OSError, ValueError) as exc:
        print(f"[imo global] {exc}", file=sys.stderr)
        return 1
    print("[imo global] uninstall complete; runtime state preserved")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage global IMO hooks and skill projections for Claude Code and Codex.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command, handler in (
        ("status", _status),
        ("doctor", _doctor),
        ("install", _install),
        ("migrate", _install),
        ("uninstall", _uninstall),
    ):
        sub = subparsers.add_parser(command)
        sub.add_argument("--global-root", help="Override IMO state root; defaults to IMO_GLOBAL_ROOT or ~/.imo")
        sub.add_argument("--host", choices=("both", "claude", "codex"))
        sub.add_argument("--claude-home", help="Override Claude home; defaults to CLAUDE_HOME or ~/.claude")
        sub.add_argument("--codex-root", help="Override Codex root; defaults to CODEX_HOME or ~/.codex")
        if command in {"status", "doctor"}:
            sub.add_argument("--json", action="store_true", help="Print machine-readable status")
        else:
            sub.add_argument("--apply", action="store_true", help="Write changes. Omit for dry-run.")
            sub.add_argument("--force", action="store_true", help="Replace unmanaged conflicting paths.")
        sub.set_defaults(func=handler)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
