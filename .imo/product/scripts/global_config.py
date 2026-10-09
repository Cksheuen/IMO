#!/usr/bin/env python3
"""Install IMO's global runtime shim and Codex-facing lazy projections."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any

import global_codex_instructions
import root_resolver


SOURCE_ROOT = Path(__file__).resolve().parents[3]
HOOK_REL = Path("hooks/codex-context.sh")
MANIFEST_REL = Path("install/managed-hashes.json")
MODULES_PATH = SOURCE_ROOT / ".imo/product/skills/modules.json"
CODEX_HOOKS_REL = Path("hooks.json")
CODEX_SKILLS_REL = Path("skills")
CODEX_AGENTS_REL = Path("install/codex/AGENTS.md")
CODEX_OWNERSHIP_REL = Path("install/codex/ownership.json")
CODEX_AGENTS_LINK_REL = Path("AGENTS.md")


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
  exec imo codex context
fi

if [[ -x "__IMO_SOURCE_ROOT__/imo" ]]; then
  exec "__IMO_SOURCE_ROOT__/imo" codex context
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
            "managed_surfaces": ["AGENTS.md", "hooks.json", "skills/"],
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


def _manifest_state(global_root: Path, codex_root: Path, manifest: dict[str, Any]) -> str:
    manifest_path = global_root / MANIFEST_REL

    if not manifest_path.exists():
        return "missing"

    if not manifest:
        return "conflict"

    expected_values = {
        "global_root": str(global_root),
        "codex_root": str(codex_root),
        "source_root": str(SOURCE_ROOT),
        "source_mode": _source_mode(),
    }

    for key, expected in expected_values.items():
        value = manifest.get(key)
        if not isinstance(value, str) or value != expected:
            return "stale"

    return "present"


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


def _manifest_hook_command(manifest: dict[str, Any]) -> str | None:
    hooks = manifest.get("codex_hooks")
    if not isinstance(hooks, dict):
        return None
    command = hooks.get("command")
    if not isinstance(command, str):
        return None
    return command


def _global_root(args: argparse.Namespace) -> Path:
    return Path(args.global_root).expanduser().resolve() if args.global_root else root_resolver.resolve_global_root()


def _codex_root(args: argparse.Namespace) -> Path:
    raw = args.codex_root or os.environ.get("CODEX_HOME") or "~/.codex"
    return Path(raw).expanduser().resolve()


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


def _hook_registration(global_root: Path) -> dict[str, Any]:
    return {
        "hooks": [
            {
                "type": "command",
                "command": str(global_root / HOOK_REL),
                "timeout": 5,
            }
        ]
    }


def _hook_command(entry: Any) -> str | None:
    if not isinstance(entry, dict):
        return None
    hooks = entry.get("hooks")
    if not isinstance(hooks, list) or len(hooks) != 1 or not isinstance(hooks[0], dict):
        return None
    command = hooks[0].get("command")
    return command if isinstance(command, str) else None


def _load_codex_hooks(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"hooks": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Codex hooks root must be an object")
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("Codex hooks field must be an object")
    return data


def _hook_registration_state(hooks_path: Path, desired_command: str, manifest_command: str | None) -> str:
    if not hooks_path.exists():
        return "missing"
    try:
        hooks = _load_codex_hooks(hooks_path)
    except FileNotFoundError:
        return "missing"
    except Exception:
        return "conflict"

    if not isinstance(hooks, dict):
        return "conflict"

    entries = hooks.get("hooks", {}).get("UserPromptSubmit", [])
    if entries is None or entries == []:
        return "missing"
    if not isinstance(entries, list):
        return "conflict"

    try:
        commands = [_hook_command(entry) for entry in entries]
    except Exception:
        return "conflict"

    if any(command is None for command in commands):
        return "conflict"
    if any(command == desired_command for command in commands):
        return "present"
    if manifest_command is not None and any(command == manifest_command for command in commands):
        return "modified"
    return "stale"


def _skill_projection_state(codex_root: Path, manifest: dict[str, Any]) -> tuple[str, int, int]:
    del manifest

    modules = _load_modules()
    total = len(modules)
    present_count = 0
    conflict = False
    modified = False
    any_path = False

    for module in modules:
        link = codex_root / CODEX_SKILLS_REL / module["name"]
        desired = (SOURCE_ROOT / module["owner_surface"]).resolve(strict=False)
        any_path = any_path or link.is_symlink() or link.exists()

        if link.is_symlink():
            if _resolved_link(link) == desired:
                present_count += 1
            else:
                modified = True
        elif link.exists():
            conflict = True

    if conflict:
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


def _diagnostic_states(global_root, codex_root, manifest):
    skill_state, count, total = _skill_projection_state(codex_root, manifest)
    states = {
        "manifest": _manifest_state(global_root, codex_root, manifest),
        "codex_context_hook": _managed_file_state(
            global_root / HOOK_REL,
            _hash_text(_hook_text(SOURCE_ROOT)),
            _manifest_file_hash(manifest, HOOK_REL),
        ),
        "codex_hook_registration": _hook_registration_state(
            codex_root / CODEX_HOOKS_REL,
            str(global_root / HOOK_REL),
            _manifest_hook_command(manifest),
        ),
        "codex_instructions": global_codex_instructions.instructions_state(
            global_root / CODEX_AGENTS_REL,
            codex_root / CODEX_AGENTS_LINK_REL,
            SOURCE_ROOT,
            manifest,
            CODEX_AGENTS_REL,
        ),
        "codex_ownership_marker": _managed_file_state(
            global_root / CODEX_OWNERSHIP_REL,
            _hash_text(_codex_ownership_text(global_root, codex_root)),
            _manifest_file_hash(manifest, CODEX_OWNERSHIP_REL),
        ),
        "codex_skill_projections": skill_state,
    }
    return states, count, total


def _diagnostic_source(manifest: dict[str, Any]) -> tuple[str, str]:
    source_root = manifest.get("source_root")
    source_mode = manifest.get("source_mode")
    return (
        source_root if isinstance(source_root, str) else str(SOURCE_ROOT),
        source_mode if isinstance(source_mode, str) else _source_mode(),
    )


def _diagnose(global_root: Path, codex_root: Path) -> dict[str, Any]:
    manifest = _load_manifest(global_root)
    states, count, total = _diagnostic_states(global_root, codex_root, manifest)
    source_root, source_mode = _diagnostic_source(manifest)
    project = root_resolver.resolve_project_root()
    issues = sorted(k for k, v in states.items() if v != "present")

    return {
        "healthy": not issues,
        "issues": issues,
        "states": states,
        "global_root": str(global_root),
        "codex_root": str(codex_root),
        "source_root": str(source_root),
        "source_mode": source_mode,
        "project_root": str(project) if project else "not detected",
        "codex_skill_projections": count,
        "codex_skill_expected": total,
    }


def _write_codex_hooks(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _add_hook_registration(path: Path, global_root: Path) -> None:
    data = _load_codex_hooks(path)
    entries = data["hooks"].setdefault("UserPromptSubmit", [])
    if not isinstance(entries, list):
        raise ValueError("Codex UserPromptSubmit hooks must be a list")
    command = str(global_root / HOOK_REL)
    entries[:] = [entry for entry in entries if _hook_command(entry) != command]
    entries.append(_hook_registration(global_root))
    _write_codex_hooks(path, data)


def _remove_hook_registration(path: Path, global_root: Path) -> None:
    if not path.is_file():
        return
    data = _load_codex_hooks(path)
    entries = data["hooks"].get("UserPromptSubmit")
    if not isinstance(entries, list):
        return
    command = str(global_root / HOOK_REL)
    entries[:] = [entry for entry in entries if _hook_command(entry) != command]
    if not entries:
        data["hooks"].pop("UserPromptSubmit", None)
    _write_codex_hooks(path, data)


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


def _is_host_skill_projection(path: Path, name: str) -> bool:
    resolved = _resolved_link(path)
    expected = (Path.home() / ".claude/skills" / name).resolve(strict=False)
    return resolved == expected


def _codex_ownership_conflict(global_root: Path, codex_root: Path, old_manifest: dict[str, Any]) -> bool:
    path = global_root / CODEX_OWNERSHIP_REL
    current = _entry_hash(path)
    if current is None:
        return False
    desired = _hash_text(_codex_ownership_text(global_root, codex_root))
    files = old_manifest.get("files", {})
    managed = files.get(CODEX_OWNERSHIP_REL.as_posix(), {}) if isinstance(files, dict) else {}
    managed_hash = managed.get("hash") if isinstance(managed, dict) else None
    return current not in {desired, managed_hash}


def _install_codex_ownership(global_root: Path, codex_root: Path) -> Path:
    path = global_root / CODEX_OWNERSHIP_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_codex_ownership_text(global_root, codex_root), encoding="utf-8")
    return path


def _skill_conflicts(codex_root: Path, old_manifest: dict[str, Any]) -> list[Path]:
    conflicts: list[Path] = []
    old_skills = old_manifest.get("codex_skills", {})
    if not isinstance(old_skills, dict):
        old_skills = {}
    for module in _load_modules():
        name = module["name"]
        path = codex_root / CODEX_SKILLS_REL / name
        desired = (SOURCE_ROOT / module["owner_surface"]).resolve(strict=False)
        current = _resolved_link(path)
        old = old_skills.get(name)
        old_target = Path(old.get("target")).resolve(strict=False) if isinstance(old, dict) and isinstance(old.get("target"), str) else None
        if not path.exists() and not path.is_symlink():
            continue
        if current in {desired, old_target} or _is_host_skill_projection(path, name):
            continue
        conflicts.append(path)
    return conflicts


def _install_skill_links(codex_root: Path, old_manifest: dict[str, Any]) -> dict[str, Any]:
    old_skills = old_manifest.get("codex_skills", {})
    if not isinstance(old_skills, dict):
        old_skills = {}
    skill_root = codex_root / CODEX_SKILLS_REL
    skill_root.mkdir(parents=True, exist_ok=True)
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


def _restore_skill_links(codex_root: Path, manifest: dict[str, Any], *, force: bool) -> list[Path]:
    conflicts: list[Path] = []
    skills = manifest.get("codex_skills", {})
    if not isinstance(skills, dict):
        return conflicts
    for name, metadata in skills.items():
        if not isinstance(metadata, dict):
            continue
        path = codex_root / CODEX_SKILLS_REL / name
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


def _manifest(
    global_root: Path,
    codex_root: Path,
    codex_skills: dict[str, Any],
    codex_agents: dict[str, Any],
    ownership_path: Path,
) -> dict[str, Any]:
    agents_path = global_root / CODEX_AGENTS_REL
    return {
        "schema_version": 4,
        "install_mode": "global-first",
        "global_root": str(global_root),
        "codex_root": str(codex_root),
        "source_root": str(SOURCE_ROOT),
        "source_mode": _source_mode(),
        "managed_files": [
            HOOK_REL.as_posix(),
            CODEX_AGENTS_REL.as_posix(),
            CODEX_OWNERSHIP_REL.as_posix(),
        ],
        "files": {
            HOOK_REL.as_posix(): {
                "kind": "file",
                "hash": _hash_text(_hook_text(SOURCE_ROOT)),
                "executable": True,
            },
            CODEX_AGENTS_REL.as_posix(): {
                "kind": "file",
                "hash": _file_hash(agents_path),
                "managed_hash": global_codex_instructions.managed_hash(SOURCE_ROOT),
            },
            CODEX_OWNERSHIP_REL.as_posix(): {
                "kind": "file",
                "hash": _file_hash(ownership_path),
            },
        },
        "codex_hooks": {
            "path": str(codex_root / CODEX_HOOKS_REL),
            "event": "UserPromptSubmit",
            "command": str(global_root / HOOK_REL),
        },
        "codex_agents": codex_agents,
        "codex_ownership": {
            "path": str(ownership_path),
            "owner": "imo",
        },
        "codex_skills": codex_skills,
    }


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

    print(
        "codex_skill_projections: "
        f"{payload.get('codex_skill_projections', 0)}/"
        f"{payload.get('codex_skill_expected', 0)}"
    )

    for key in (
        "global_root",
        "codex_root",
        "source_root",
        "source_mode",
        "project_root",
    ):
        print(f"{key}: {payload.get(key)}")

    issues = payload.get("issues", [])
    print(f"issues: {', '.join(issues) if issues else 'none'}")

    print(f"healthy: {'yes' if payload.get('healthy') else 'no'}")


def _status(args: argparse.Namespace) -> int:
    payload = _diagnose(_global_root(args), _codex_root(args))
    _print_diagnostic("IMO global status", payload, bool(args.json))
    return 0


def _doctor(args: argparse.Namespace) -> int:
    payload = _diagnose(_global_root(args), _codex_root(args))
    _print_diagnostic("IMO global doctor", payload, bool(args.json))
    return 0 if payload["healthy"] else 1


def _install(args: argparse.Namespace) -> int:
    global_root = _global_root(args)
    codex_root = _codex_root(args)
    hook_path = global_root / HOOK_REL
    manifest_path = global_root / MANIFEST_REL
    hooks_path = codex_root / CODEX_HOOKS_REL
    agents_path = global_root / CODEX_AGENTS_REL
    ownership_path = global_root / CODEX_OWNERSHIP_REL
    apply = bool(args.apply)
    action = "install" if args.command == "install" else "migrate"
    print(f"[imo global] {action} {'apply' if apply else 'dry-run'}: {global_root}")
    print(f"[imo global] Codex root: {codex_root}")
    print(f"[imo global] source: {SOURCE_ROOT} ({_source_mode()})")
    print(
        f"[imo global] would manage: {hook_path}, {hooks_path}, {agents_path}, "
        f"{len(_load_modules())} lazy skill projection(s), and the Codex ownership marker"
    )
    old_manifest = _load_manifest(global_root)
    current_hook = _entry_hash(hook_path)
    managed_hook = old_manifest.get("files", {}).get(HOOK_REL.as_posix(), {}) if isinstance(old_manifest.get("files"), dict) else {}
    managed_hash = managed_hook.get("hash") if isinstance(managed_hook, dict) else None
    desired_hash = _hash_text(_hook_text(SOURCE_ROOT))
    if current_hook not in {None, desired_hash, managed_hash} and not args.force:
        print(f"[imo global] refused to overwrite unmanaged file: {hook_path}", file=sys.stderr)
        return 1
    if global_codex_instructions.file_conflict(
        agents_path, SOURCE_ROOT, old_manifest, CODEX_AGENTS_REL
    ) and not args.force:
        print(f"[imo global] refused to overwrite unmanaged file: {agents_path}", file=sys.stderr)
        return 1
    if _codex_ownership_conflict(global_root, codex_root, old_manifest) and not args.force:
        print(f"[imo global] refused to overwrite unmanaged file: {ownership_path}", file=sys.stderr)
        return 1
    if global_codex_instructions.link_conflict(
        codex_root / CODEX_AGENTS_LINK_REL,
        global_root / CODEX_AGENTS_REL,
        old_manifest,
    ) and not args.force:
        print(f"[imo global] refused unmanaged Codex AGENTS path: {codex_root / CODEX_AGENTS_LINK_REL}", file=sys.stderr)
        return 1
    conflicts = _skill_conflicts(codex_root, old_manifest)
    if conflicts and not args.force:
        print("[imo global] refused unmanaged Codex skill path(s): " + ", ".join(str(path) for path in conflicts), file=sys.stderr)
        return 1
    try:
        _load_codex_hooks(hooks_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[imo global] invalid Codex hooks file: {exc}", file=sys.stderr)
        return 1

    if not apply:
        print("[imo global] pass --apply to write managed global files")
        return 0

    hook_path.parent.mkdir(parents=True, exist_ok=True)
    if hook_path.is_symlink() or hook_path.is_file():
        hook_path.unlink()
    hook_path.write_text(_hook_text(SOURCE_ROOT), encoding="utf-8")
    hook_path.chmod(0o755)
    codex_agents = global_codex_instructions.install_agents(
        agents_path,
        codex_root / CODEX_AGENTS_LINK_REL,
        SOURCE_ROOT,
        old_manifest,
        CODEX_AGENTS_REL,
        force=bool(args.force),
    )
    ownership_path = _install_codex_ownership(global_root, codex_root)
    codex_skills = _install_skill_links(codex_root, old_manifest)
    _add_hook_registration(hooks_path, global_root)
    _write_manifest(global_root, _manifest(global_root, codex_root, codex_skills, codex_agents, ownership_path))
    print(f"[imo global] {action} complete")
    print(f"[imo global] manifest: {manifest_path}")
    return 0


def _uninstall(args: argparse.Namespace) -> int:
    global_root = _global_root(args)
    manifest = _load_manifest(global_root)
    recorded_codex = manifest.get("codex_root")
    codex_root = Path(recorded_codex).resolve() if isinstance(recorded_codex, str) and not args.codex_root else _codex_root(args)
    manifest_path = global_root / MANIFEST_REL
    hook_path = global_root / HOOK_REL
    hooks_path = codex_root / CODEX_HOOKS_REL
    agents_path = global_root / CODEX_AGENTS_REL
    ownership_path = global_root / CODEX_OWNERSHIP_REL
    apply = bool(args.apply)
    print(f"[imo global] uninstall {'apply' if apply else 'dry-run'}: {global_root}")
    print(f"[imo global] would restore Codex skill projections under: {codex_root / CODEX_SKILLS_REL}")
    print(f"[imo global] would restore Codex AGENTS path: {codex_root / CODEX_AGENTS_LINK_REL}")
    print(f"[imo global] runtime state under {global_root / 'runtime'} and {global_root / 'projects'} is preserved")
    if not apply:
        print("[imo global] pass --apply to remove managed global files")
        return 0

    current_hook = _entry_hash(hook_path)
    desired_hash = _hash_text(_hook_text(SOURCE_ROOT))
    managed = manifest.get("files", {}).get(HOOK_REL.as_posix(), {}) if isinstance(manifest.get("files"), dict) else {}
    managed_hash = managed.get("hash") if isinstance(managed, dict) else None
    if current_hook not in {None, desired_hash, managed_hash} and not args.force:
        print(f"[imo global] refused to remove unmanaged file: {hook_path}", file=sys.stderr)
        return 1
    files = manifest.get("files", {})
    for managed_rel, path in (
        (CODEX_AGENTS_REL, agents_path),
        (CODEX_OWNERSHIP_REL, ownership_path),
    ):
        metadata = files.get(managed_rel.as_posix(), {}) if isinstance(files, dict) else {}
        managed_hash = metadata.get("hash") if isinstance(metadata, dict) else None
        current = _entry_hash(path)
        if current not in {None, managed_hash} and not args.force:
            print(f"[imo global] refused to remove unmanaged file: {path}", file=sys.stderr)
            return 1
    agent_conflicts = global_codex_instructions.restore_agents(
        codex_root / CODEX_AGENTS_LINK_REL,
        manifest,
        force=bool(args.force),
    )
    if agent_conflicts:
        print("[imo global] kept modified Codex AGENTS path(s): " + ", ".join(str(path) for path in agent_conflicts), file=sys.stderr)
        return 1
    conflicts = _restore_skill_links(codex_root, manifest, force=bool(args.force))
    if conflicts:
        print("[imo global] kept modified Codex skill path(s): " + ", ".join(str(path) for path in conflicts), file=sys.stderr)
        return 1
    _remove_hook_registration(hooks_path, global_root)
    external_agents = global_codex_instructions.external_content(agents_path)
    if external_agents.strip():
        agents_path.write_text(external_agents, encoding="utf-8")
        print(f"[imo global] preserved non-IMO Codex instructions at: {agents_path}")
    removable = [hook_path, ownership_path, manifest_path]
    if not external_agents.strip():
        removable.append(agents_path)
    for path in removable:
        if path.exists() or path.is_symlink():
            path.unlink()
    for directory in (hook_path.parent, agents_path.parent, ownership_path.parent, manifest_path.parent):
        try:
            directory.rmdir()
        except OSError:
            pass
    print("[imo global] uninstall complete")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage global IMO runtime and Codex lazy projections.")
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
