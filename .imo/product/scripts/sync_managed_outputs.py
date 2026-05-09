#!/usr/bin/env python3
"""Sync IMO-managed adapter outputs into host surfaces."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


STATE_RELATIVE_PATH = Path(".imo/.runtime/managed-hashes.json")
MANAGED_BLOCK_TEMPLATE = "# >>> IMO managed: {block_id}\n{body}\n# <<< IMO managed: {block_id}\n"


class SyncError(RuntimeError):
    """Raised when a sync target cannot be updated safely."""


@dataclass(frozen=True)
class PlannedWrite:
    path: Path
    content: str
    reason: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive path
        raise SyncError(f"{path}: invalid JSON ({exc})") from exc


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_manifest(root: Path, platform: str) -> dict[str, Any]:
    manifest_path = root / ".imo" / "adapters" / platform / "manifest.json"
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict):
        raise SyncError(f"{manifest_path}: manifest must be a JSON object")
    return manifest


def load_state(root: Path) -> dict[str, dict[str, str]]:
    raw = load_json(root / STATE_RELATIVE_PATH)
    if not isinstance(raw, dict):
        return {"managed_files": {}}

    managed_files = raw.get("managed_files")
    if not isinstance(managed_files, dict):
        managed_files = {}

    normalized = {
        str(path): str(file_hash)
        for path, file_hash in managed_files.items()
        if isinstance(path, str) and isinstance(file_hash, str)
    }
    return {"managed_files": normalized}


def merge_json(base: Any, overlay: Any) -> Any:
    if isinstance(base, dict) and isinstance(overlay, dict):
        merged = dict(base)
        for key, value in overlay.items():
            merged[key] = merge_json(merged.get(key), value)
        return merged
    if isinstance(base, list) and isinstance(overlay, list):
        return merge_json_lists(base, overlay)
    return overlay


def list_item_identity(item: Any) -> tuple[str, Any] | None:
    if not isinstance(item, dict):
        return None

    matcher = item.get("matcher")
    if isinstance(matcher, str):
        return ("matcher", matcher)

    command = item.get("command")
    if isinstance(command, str):
        return ("command", command)

    hooks = item.get("hooks")
    if isinstance(hooks, list):
        commands = tuple(
            hook.get("command")
            for hook in hooks
            if isinstance(hook, dict) and isinstance(hook.get("command"), str)
        )
        if commands:
            return ("hooks", commands)

    return None


def merge_json_lists(base: list[Any], overlay: list[Any]) -> list[Any]:
    identities = [list_item_identity(item) for item in base]
    if not any(identity is not None for identity in identities):
        return list(overlay)

    merged = list(base)
    index_by_identity = {
        identity: idx
        for idx, identity in enumerate(identities)
        if identity is not None
    }

    for item in overlay:
        identity = list_item_identity(item)
        if identity is None:
            if item not in merged:
                merged.append(item)
            continue

        if identity in index_by_identity:
            idx = index_by_identity[identity]
            merged[idx] = merge_json(merged[idx], item)
        else:
            index_by_identity[identity] = len(merged)
            merged.append(item)

    return merged


def plan_managed_file(
    root: Path,
    state: dict[str, dict[str, str]],
    source_rel: str,
    target_rel: str,
    force: bool,
) -> tuple[PlannedWrite | None, str]:
    source_path = root / source_rel
    target_path = root / target_rel

    try:
        rendered = source_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise SyncError(f"{source_rel}: source template not found") from exc

    new_hash = sha256_text(rendered)
    previous_hash = state["managed_files"].get(target_rel)

    if target_path.exists():
        current = target_path.read_text(encoding="utf-8")
        if current == rendered:
            return None, new_hash

        current_hash = sha256_text(current)
        if previous_hash is None and not force:
            raise SyncError(
                f"{target_rel}: target exists without managed hash; "
                "re-run with --force to adopt it"
            )
        if previous_hash is not None and current_hash != previous_hash and not force:
            raise SyncError(
                f"{target_rel}: local drift detected; re-run with --force to overwrite"
            )
    return PlannedWrite(target_path, rendered, "managed file"), new_hash


def plan_json_merge(root: Path, source_rel: str, target_rel: str) -> PlannedWrite | None:
    fragment_path = root / source_rel
    target_path = root / target_rel

    fragment = load_json(fragment_path)
    if not isinstance(fragment, dict):
        raise SyncError(f"{source_rel}: JSON fragment must be an object")

    existing = load_json(target_path)
    if existing is None:
        existing = {}
    if not isinstance(existing, dict):
        raise SyncError(f"{target_rel}: existing JSON target must be an object")

    merged = merge_json(existing, fragment)
    rendered = json.dumps(merged, indent=2, ensure_ascii=False) + "\n"

    if target_path.exists() and target_path.read_text(encoding="utf-8") == rendered:
        return None
    return PlannedWrite(target_path, rendered, "json merge")


def render_managed_block(block_id: str, body: str) -> str:
    normalized_body = body.rstrip("\n")
    return MANAGED_BLOCK_TEMPLATE.format(block_id=block_id, body=normalized_body)


def plan_toml_block(
    root: Path,
    source_rel: str,
    target_rel: str,
    block_id: str,
    force: bool,
) -> PlannedWrite | None:
    source_path = root / source_rel
    target_path = root / target_rel

    try:
        block_body = source_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise SyncError(f"{source_rel}: TOML managed block source not found") from exc

    managed_block = render_managed_block(block_id, block_body)
    start_marker = f"# >>> IMO managed: {block_id}"
    end_marker = f"# <<< IMO managed: {block_id}"

    if not target_path.exists():
        return PlannedWrite(target_path, managed_block, "toml managed block")

    existing = target_path.read_text(encoding="utf-8")
    if start_marker in existing and end_marker in existing:
        pattern = re.compile(
            rf"{re.escape(start_marker)}\n.*?\n{re.escape(end_marker)}\n?",
            re.DOTALL,
        )
        replaced = pattern.sub(managed_block, existing)
        if replaced == existing:
            return None
        return PlannedWrite(target_path, replaced, "toml managed block")

    if existing.strip() == block_body.strip():
        return PlannedWrite(target_path, managed_block, "toml managed block bootstrap")

    if not force:
        raise SyncError(
            f"{target_rel}: unmanaged TOML content differs from IMO block; "
            "re-run with --force to replace the file"
        )
    return PlannedWrite(target_path, managed_block, "toml managed block force replace")


def collect_entries(manifest: dict[str, Any], key: str) -> list[dict[str, Any]]:
    raw = manifest.get(key, [])
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise SyncError(f"manifest field `{key}` must be a list")
    return [entry for entry in raw if isinstance(entry, dict)]


def plan_platform_sync(
    root: Path,
    state: dict[str, dict[str, str]],
    platform: str,
    force: bool,
) -> tuple[list[PlannedWrite], dict[str, dict[str, str]]]:
    manifest = load_manifest(root, platform)
    next_state = {"managed_files": dict(state["managed_files"])}
    planned: list[PlannedWrite] = []

    for entry in collect_entries(manifest, "managed_files"):
        source_rel = entry.get("source")
        target_rel = entry.get("target")
        if not isinstance(source_rel, str) or not isinstance(target_rel, str):
            raise SyncError(f"{platform}: managed file entries require string source/target")
        write, new_hash = plan_managed_file(root, state, source_rel, target_rel, force)
        next_state["managed_files"][target_rel] = new_hash
        if write is not None:
            planned.append(write)

    for entry in collect_entries(manifest, "json_merges"):
        source_rel = entry.get("source")
        target_rel = entry.get("target")
        if not isinstance(source_rel, str) or not isinstance(target_rel, str):
            raise SyncError(f"{platform}: json merge entries require string source/target")
        write = plan_json_merge(root, source_rel, target_rel)
        if write is not None:
            planned.append(write)

    for entry in collect_entries(manifest, "toml_blocks"):
        source_rel = entry.get("source")
        target_rel = entry.get("target")
        block_id = entry.get("block_id")
        if (
            not isinstance(source_rel, str)
            or not isinstance(target_rel, str)
            or not isinstance(block_id, str)
        ):
            raise SyncError(
                f"{platform}: toml block entries require string source/target/block_id"
            )
        write = plan_toml_block(root, source_rel, target_rel, block_id, force)
        if write is not None:
            planned.append(write)

    return planned, next_state


def apply_writes(writes: list[PlannedWrite]) -> None:
    for write in writes:
        write.path.parent.mkdir(parents=True, exist_ok=True)
        write.path.write_text(write.content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync IMO-managed adapter outputs into host surfaces.",
    )
    parser.add_argument("command", choices=("sync", "generate"))
    parser.add_argument(
        "target",
        nargs="?",
        default="all",
        choices=("all", "claude", "codex"),
        help="Which host surface to update",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite managed-file drift or adopt unmanaged targets",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = repo_root()
    state = load_state(root)

    platforms = ["claude", "codex"] if args.target == "all" else [args.target]
    planned_writes: list[PlannedWrite] = []
    next_state = {"managed_files": dict(state["managed_files"])}

    try:
        for platform in platforms:
            platform_writes, next_state = plan_platform_sync(
                root=root,
                state=next_state,
                platform=platform,
                force=args.force,
            )
            planned_writes.extend(platform_writes)
    except SyncError as exc:
        print(f"imo {args.command}: {exc}", file=sys.stderr)
        return 1

    apply_writes(planned_writes)

    if next_state != state:
        write_json(root / STATE_RELATIVE_PATH, next_state)

    print(f"imo {args.command}: synced {', '.join(platforms)}")
    if planned_writes:
        for write in planned_writes:
            rel_path = write.path.relative_to(root)
            print(f"- updated {rel_path} ({write.reason})")
    else:
        print("- no host file changes")

    if next_state != state:
        print(f"- updated {STATE_RELATIVE_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
