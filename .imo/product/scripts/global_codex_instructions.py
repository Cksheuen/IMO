"""Manage IMO's bounded block inside the global Codex AGENTS file."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any


START_MARKER = "<!-- imo:managed codex-instructions:start -->"
END_MARKER = "<!-- imo:managed codex-instructions:end -->"


def agents_text(source_root: Path) -> str:
    return f"""# Codex global instructions (IMO-owned)

This block is managed by IMO at {source_root}.

## Ownership and boundaries

- Claude Code configuration (`~/.claude/CLAUDE.md`, rules, agents, settings,
  and MCP) is not a Codex instruction source.
- Codex configuration, agents, hooks, plugins, and MCP servers are Codex-owned.
- IMO is the shared governance layer: its global hook injects only the bounded
  context once per session; detailed skills and project rules are
  loaded on demand.
- Do not import or mirror Claude Code MCP servers, plugin settings, commands,
  or generated AGENTS files unless the user explicitly asks for a migration.

## Working defaults

- Follow the user's request, repository-local `AGENTS.md`, and explicit task
  instructions before this advisory baseline.
- Preserve existing dirty worktree changes and make the smallest scoped edit.
- Keep commands, context, and generated output bounded; verify changes at the
  source and consumer surfaces before claiming completion.
"""


def legacy_agents_text(source_root: Path) -> str:
    return agents_text(source_root).replace(
        "This block is managed by IMO at", "This file is managed by IMO at", 1
    )


def managed_block(source_root: Path) -> str:
    return f"{START_MARKER}\n{agents_text(source_root)}{END_MARKER}\n"


def _hash_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def managed_hash(source_root: Path) -> str:
    return _hash_text(managed_block(source_root))


def _file_hash(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _recorded_file(manifest: dict[str, Any], relative: Path) -> dict[str, Any]:
    files = manifest.get("files")
    if not isinstance(files, dict):
        return {}
    entry = files.get(relative.as_posix())
    return entry if isinstance(entry, dict) else {}


def _split_managed(text: str) -> tuple[str, str, str] | None:
    if text.count(START_MARKER) != 1 or text.count(END_MARKER) != 1:
        return None
    start = text.index(START_MARKER)
    end = text.index(END_MARKER, start) + len(END_MARKER)
    if end < start:
        return None
    if end < len(text) and text[end] == "\n":
        end += 1
    return text[:start], text[start:end], text[end:]


def file_state(
    path: Path,
    source_root: Path,
    manifest: dict[str, Any],
    relative: Path,
) -> str:
    if not path.exists() and not path.is_symlink():
        return "missing"
    if path.is_symlink() or not path.is_file():
        return "conflict"

    text = path.read_text(encoding="utf-8")
    parts = _split_managed(text)
    recorded = _recorded_file(manifest, relative)
    recorded_managed = recorded.get("managed_hash")
    recorded_whole = recorded.get("hash")

    if parts is not None:
        current_block = parts[1]
        if current_block == managed_block(source_root):
            return "present"
        if isinstance(recorded_managed, str) and _hash_text(current_block) == recorded_managed:
            return "modified"
        return "conflict"

    has_any_marker = START_MARKER in text or END_MARKER in text
    if has_any_marker:
        return "conflict"
    if text.endswith(legacy_agents_text(source_root)):
        return "stale"
    if isinstance(recorded_whole, str) and _file_hash(path) == recorded_whole:
        return "modified"
    return "conflict"


def file_conflict(
    path: Path,
    source_root: Path,
    manifest: dict[str, Any],
    relative: Path,
) -> bool:
    return file_state(path, source_root, manifest, relative) == "conflict"


def _resolved_link(path: Path) -> Path | None:
    if not path.is_symlink():
        return None
    target = Path(os.readlink(path))
    if not target.is_absolute():
        target = path.parent / target
    return target.resolve(strict=False)


def _symlink_metadata(path: Path) -> dict[str, str] | None:
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink():
        return {"kind": "symlink", "target": os.readlink(path)}
    return {"kind": "unmanaged"}


def link_conflict(
    link: Path,
    desired: Path,
    old_manifest: dict[str, Any],
) -> bool:
    if not link.exists() and not link.is_symlink():
        return False
    old = old_manifest.get("codex_agents")
    old_target = (
        Path(old.get("target")).resolve(strict=False)
        if isinstance(old, dict) and isinstance(old.get("target"), str)
        else None
    )
    allowed = {
        desired.resolve(strict=False),
        (Path.home() / ".claude/shared-knowledge/AGENTS.md").resolve(strict=False),
    }
    if old_target is not None:
        allowed.add(old_target)
    return _resolved_link(link) not in allowed


def instructions_state(
    agents_path: Path,
    link: Path,
    source_root: Path,
    manifest: dict[str, Any],
    relative: Path,
) -> str:
    current_file_state = file_state(agents_path, source_root, manifest, relative)
    expected = agents_path.resolve(strict=False)
    recorded_target = None
    metadata = manifest.get("codex_agents")
    if isinstance(metadata, dict) and isinstance(metadata.get("target"), str):
        recorded_target = Path(metadata["target"]).resolve(strict=False)

    resolved = _resolved_link(link)
    if not link.exists() and not link.is_symlink():
        link_state = "missing"
    elif not link.is_symlink():
        link_state = "conflict"
    elif resolved == expected:
        link_state = "present"
    elif recorded_target is not None and resolved == recorded_target:
        link_state = "modified"
    else:
        link_state = "stale"

    if current_file_state == "present" and link_state == "present":
        return "present"
    if current_file_state == "missing" and link_state == "missing":
        return "missing"
    if "conflict" in {current_file_state, link_state}:
        return "conflict"
    if "modified" in {current_file_state, link_state}:
        return "modified"
    return "stale"


def _merge(text: str, source_root: Path, recorded_hash: str | None, force: bool) -> str:
    parts = _split_managed(text)
    if parts is not None:
        return parts[0] + managed_block(source_root) + parts[2]
    if START_MARKER in text or END_MARKER in text:
        if not force:
            raise ValueError("malformed IMO managed instruction block")
        return managed_block(source_root)
    legacy = legacy_agents_text(source_root)
    if text.endswith(legacy):
        return text[: -len(legacy)] + managed_block(source_root)
    if recorded_hash is not None and _hash_text(text) == recorded_hash:
        return managed_block(source_root)
    if text and not force:
        raise ValueError("unmanaged Codex instructions")
    return managed_block(source_root)


def install_agents(
    agents_path: Path,
    link_path: Path,
    source_root: Path,
    manifest: dict[str, Any],
    relative: Path,
    *,
    force: bool,
) -> dict[str, Any]:
    old = manifest.get("codex_agents")
    previous = old.get("previous") if isinstance(old, dict) else _symlink_metadata(link_path)
    recorded_hash = _recorded_file(manifest, relative).get("hash")
    current = agents_path.read_text(encoding="utf-8") if agents_path.is_file() else ""
    merged = _merge(current, source_root, recorded_hash, force)

    agents_path.parent.mkdir(parents=True, exist_ok=True)
    if agents_path.is_symlink() or agents_path.is_file():
        agents_path.unlink()
    elif agents_path.exists():
        raise IsADirectoryError(f"cannot replace unmanaged Codex instructions: {agents_path}")
    agents_path.write_text(merged, encoding="utf-8")

    link_path.parent.mkdir(parents=True, exist_ok=True)
    if link_path.is_symlink() or link_path.is_file():
        link_path.unlink()
    elif link_path.exists():
        raise IsADirectoryError(f"cannot replace unmanaged Codex AGENTS path: {link_path}")
    os.symlink(str(agents_path), link_path)
    return {"path": str(link_path), "target": str(agents_path), "previous": previous}


def restore_agents(link: Path, manifest: dict[str, Any], *, force: bool) -> list[Path]:
    conflicts: list[Path] = []
    metadata = manifest.get("codex_agents")
    if not isinstance(metadata, dict):
        return conflicts
    target = metadata.get("target")
    expected = Path(target).resolve(strict=False) if isinstance(target, str) else None
    current = _resolved_link(link)
    if (link.exists() or link.is_symlink()) and current != expected and not force:
        return [link]
    if link.is_symlink() or link.is_file():
        link.unlink()
    previous = metadata.get("previous")
    if isinstance(previous, dict) and previous.get("kind") == "symlink" and isinstance(previous.get("target"), str):
        link.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(previous["target"], link)
    return conflicts


def external_content(path: Path) -> str:
    if not path.is_file() or path.is_symlink():
        return ""
    text = path.read_text(encoding="utf-8")
    parts = _split_managed(text)
    if parts is None:
        return ""
    return parts[0] + parts[2]
