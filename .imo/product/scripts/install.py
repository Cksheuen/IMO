#!/usr/bin/env python3
"""Install IMO direct-run assets into a target repository."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
from typing import Any, Iterable

import root_resolver


ROOT = Path(__file__).resolve().parents[3]
MANIFEST_REL = Path(".imo/.runtime/install/managed-hashes.json")
PROJECT_MARKER_REL = root_resolver.PROJECT_MARKER_REL
GITIGNORE_START = "# IMO:START managed direct-run profile"
GITIGNORE_END = "# IMO:END managed direct-run profile"
GITIGNORE_PATTERNS = [
    "!imo",
    "!.imo/",
    "!.imo/**",
    "!scripts/",
    "!scripts/**",
    "!skills/",
    "!skills/**",
]
INSTALL_ROOTS = [
    Path(".imo"),
    Path("imo"),
    Path("scripts"),
    Path("skills"),
]
EXCLUDED_PARTS = {
    ".runtime",
    "__pycache__",
    ".DS_Store",
}
EXCLUDED_SUFFIXES = {
    ".pyc",
    ".pyo",
}


def _is_present(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _to_posix(path: Path) -> str:
    return path.as_posix()


def _file_hash(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _symlink_hash(path: Path) -> str:
    return "symlink:" + os.readlink(path)


def _entry_hash(path: Path) -> str:
    if path.is_symlink():
        return _symlink_hash(path)
    return _file_hash(path)


def _block_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _should_exclude(path: Path) -> bool:
    if path == PROJECT_MARKER_REL:
        return True
    if any(part in EXCLUDED_PARTS for part in path.parts):
        return True
    return path.suffix in EXCLUDED_SUFFIXES


def _iter_source_entries(source_root: Path) -> list[Path]:
    entries: list[Path] = []
    for root in INSTALL_ROOTS:
        source = source_root / root
        if not _is_present(source):
            continue
        if source.is_file() or source.is_symlink():
            if not _should_exclude(root):
                entries.append(root)
            continue
        for path in sorted(source.rglob("*")):
            relative = path.relative_to(source_root)
            if _should_exclude(relative):
                continue
            if path.is_dir() and not path.is_symlink():
                continue
            entries.append(relative)
    return sorted(set(entries), key=_to_posix)


def _load_manifest(target_root: Path) -> dict[str, Any]:
    path = target_root / MANIFEST_REL
    if not path.is_file():
        return {"schema_version": 1, "files": {}}
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ValueError(f"unsupported IMO install manifest: {path}")
    files = data.get("files")
    if not isinstance(files, dict):
        raise ValueError(f"invalid IMO install manifest files map: {path}")
    return data


def _save_manifest(target_root: Path, manifest: dict[str, Any]) -> None:
    path = target_root / MANIFEST_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest = dict(manifest)
    manifest["schema_version"] = 1
    manifest["profile"] = "direct-run"
    manifest["managed_roots"] = [_to_posix(root) for root in INSTALL_ROOTS]
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _source_metadata(source_root: Path, relative: Path) -> dict[str, Any]:
    source = source_root / relative
    if source.is_symlink():
        return {"kind": "symlink", "hash": _symlink_hash(source), "target": os.readlink(source)}
    mode = source.stat().st_mode
    return {
        "kind": "file",
        "hash": _file_hash(source),
        "executable": bool(mode & stat.S_IXUSR),
    }


def _project_marker_metadata(target_root: Path) -> dict[str, Any]:
    text = root_resolver.project_marker_text(target_root)
    return {
        "kind": "project-marker",
        "hash": _block_hash(text),
        "project_id": root_resolver.project_marker_payload(target_root)["project_id"],
    }


def _write_project_marker(target_root: Path, *, dry_run: bool) -> dict[str, Any]:
    metadata = _project_marker_metadata(target_root)
    if not dry_run:
        target = target_root / PROJECT_MARKER_REL
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(root_resolver.project_marker_text(target_root), encoding="utf-8")
    return metadata


def _copy_entry(source_root: Path, target_root: Path, relative: Path, *, dry_run: bool) -> dict[str, Any]:
    source = source_root / relative
    target = target_root / relative
    metadata = _source_metadata(source_root, relative)
    if dry_run:
        return metadata

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or target.is_file():
        target.unlink()
    elif target.exists():
        raise IsADirectoryError(f"target path is a directory: {target}")

    if source.is_symlink():
        os.symlink(os.readlink(source), target)
    else:
        shutil.copy2(source, target)
    return metadata


def _current_hash(path: Path) -> str | None:
    if not _is_present(path):
        return None
    if path.is_dir() and not path.is_symlink():
        return None
    return _entry_hash(path)


def _gitignore_block() -> str:
    lines = [GITIGNORE_START, *GITIGNORE_PATTERNS, GITIGNORE_END]
    return "\n".join(lines) + "\n"


def _replace_gitignore_block(existing: str, block: str) -> tuple[str, bool]:
    start = existing.find(GITIGNORE_START)
    end = existing.find(GITIGNORE_END, start if start >= 0 else 0)
    if start >= 0 and end >= 0:
        end += len(GITIGNORE_END)
        suffix = existing[end:]
        if suffix.startswith("\n"):
            suffix = suffix[1:]
        return existing[:start] + block + suffix, True
    separator = "" if not existing or existing.endswith("\n") else "\n"
    return existing + separator + block, False


def _ensure_gitignore(target_root: Path, *, dry_run: bool) -> dict[str, str]:
    gitignore = target_root / ".gitignore"
    block = _gitignore_block()
    existing = gitignore.read_text(encoding="utf-8") if gitignore.exists() else ""
    existing_lines = set(existing.splitlines())
    if GITIGNORE_START not in existing and set(GITIGNORE_PATTERNS).issubset(existing_lines):
        return {"kind": "gitignore-lines", "hash": _block_hash(block)}
    updated, _ = _replace_gitignore_block(existing, block)
    if not dry_run and updated != existing:
        gitignore.write_text(updated, encoding="utf-8")
    return {"kind": "gitignore-block", "hash": _block_hash(block)}


def _remove_gitignore_block(target_root: Path, *, dry_run: bool) -> None:
    gitignore = target_root / ".gitignore"
    if not gitignore.exists():
        return
    existing = gitignore.read_text(encoding="utf-8")
    start = existing.find(GITIGNORE_START)
    end = existing.find(GITIGNORE_END, start if start >= 0 else 0)
    if start < 0 or end < 0:
        return
    end += len(GITIGNORE_END)
    suffix = existing[end:]
    if suffix.startswith("\n"):
        suffix = suffix[1:]
    updated = existing[:start] + suffix
    if not dry_run:
        gitignore.write_text(updated, encoding="utf-8")


def _relative_list(items: Iterable[Path]) -> str:
    return ", ".join(_to_posix(item) for item in sorted(items, key=_to_posix))


def _is_safe_to_write(target: Path, old_metadata: dict[str, Any] | None, new_metadata: dict[str, Any]) -> bool:
    current = _current_hash(target)
    if current is None:
        return True
    if current == new_metadata.get("hash"):
        return True
    if old_metadata and current == old_metadata.get("hash"):
        return True
    return False


def _install_or_update(args: argparse.Namespace, *, update: bool) -> int:
    source_root = ROOT
    target_root = Path(args.target).expanduser().resolve()
    target_root.mkdir(parents=True, exist_ok=True)

    try:
        old_manifest = _load_manifest(target_root)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[imo install] failed to read manifest: {exc}", file=sys.stderr)
        return 1

    old_files = old_manifest.get("files", {})
    assert isinstance(old_files, dict)

    entries = _iter_source_entries(source_root)
    new_files: dict[str, Any] = {}
    planned_writes: list[Path] = []
    planned_removals: list[Path] = []
    conflicts: list[Path] = []
    write_project_marker = False

    for relative in entries:
        rel_key = _to_posix(relative)
        target = target_root / relative
        new_metadata = _source_metadata(source_root, relative)
        old_metadata = old_files.get(rel_key) if isinstance(old_files.get(rel_key), dict) else None
        if not args.force and not _is_safe_to_write(target, old_metadata, new_metadata):
            conflicts.append(relative)
            if old_metadata:
                new_files[rel_key] = old_metadata
            continue
        current = _current_hash(target)
        if current != new_metadata["hash"]:
            planned_writes.append(relative)
        new_files[rel_key] = new_metadata

    marker_key = _to_posix(PROJECT_MARKER_REL)
    marker_target = target_root / PROJECT_MARKER_REL
    marker_metadata = _project_marker_metadata(target_root)
    marker_old_metadata = old_files.get(marker_key) if isinstance(old_files.get(marker_key), dict) else None
    if not args.force and not _is_safe_to_write(marker_target, marker_old_metadata, marker_metadata):
        conflicts.append(PROJECT_MARKER_REL)
        if marker_old_metadata:
            new_files[marker_key] = marker_old_metadata
    else:
        if _current_hash(marker_target) != marker_metadata["hash"]:
            write_project_marker = True
        new_files[marker_key] = marker_metadata

    if update:
        source_keys = {_to_posix(relative) for relative in entries}
        source_keys.add(marker_key)
        for rel_key, metadata in sorted(old_files.items()):
            if rel_key in source_keys:
                continue
            if not isinstance(metadata, dict):
                continue
            target = target_root / rel_key
            current = _current_hash(target)
            if current is None:
                continue
            if current == metadata.get("hash"):
                planned_removals.append(Path(rel_key))
            else:
                conflicts.append(Path(rel_key))
                new_files[rel_key] = metadata

    if conflicts:
        print(
            f"[imo install] refused to overwrite user-modified file(s): {_relative_list(conflicts)}",
            file=sys.stderr,
        )
        print("[imo install] re-run with --force to overwrite", file=sys.stderr)
        return 1

    manifest = {
        "files": new_files,
        "gitignore": _ensure_gitignore(target_root, dry_run=args.dry_run),
    }

    for relative in planned_writes:
        _copy_entry(source_root, target_root, relative, dry_run=args.dry_run)

    for relative in planned_removals:
        if not args.dry_run:
            target = target_root / relative
            if target.is_symlink() or target.is_file():
                target.unlink()

    if write_project_marker:
        _write_project_marker(target_root, dry_run=args.dry_run)

    if not args.dry_run:
        _save_manifest(target_root, manifest)

    action = "update" if update else "init"
    print(f"[imo install] {action} complete: {target_root}")
    print(f"[imo install] files written: {len(planned_writes)}; files removed: {len(planned_removals)}")
    print(f"[imo install] verify with: {target_root / 'imo'} verify")
    return 0


def _cleanup_empty_dirs(target_root: Path, roots: Iterable[Path]) -> None:
    candidates: list[Path] = []
    for root in roots:
        full = target_root / root
        if full.is_dir():
            candidates.extend([path for path in full.rglob("*") if path.is_dir()])
            candidates.append(full)
    for directory in sorted(candidates, key=lambda path: len(path.parts), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass


def _uninstall(args: argparse.Namespace) -> int:
    target_root = Path(args.target).expanduser().resolve()
    try:
        manifest = _load_manifest(target_root)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[imo install] failed to read manifest: {exc}", file=sys.stderr)
        return 1

    files = manifest.get("files", {})
    if not isinstance(files, dict) or not files:
        print(f"[imo install] no managed IMO install found: {target_root}", file=sys.stderr)
        return 1

    conflicts: list[Path] = []
    removed = 0
    for rel_key, metadata in sorted(files.items(), reverse=True):
        if not isinstance(metadata, dict):
            continue
        target = target_root / rel_key
        current = _current_hash(target)
        if current is None:
            continue
        if args.force or current == metadata.get("hash"):
            if not args.dry_run:
                target.unlink()
            removed += 1
        else:
            conflicts.append(Path(rel_key))

    if conflicts:
        print(
            f"[imo install] kept user-modified file(s): {_relative_list(conflicts)}",
            file=sys.stderr,
        )
        print("[imo install] re-run uninstall with --force to remove them", file=sys.stderr)
        return 1

    if not args.dry_run:
        _remove_gitignore_block(target_root, dry_run=False)
        manifest_path = target_root / MANIFEST_REL
        if manifest_path.exists():
            manifest_path.unlink()
        _cleanup_empty_dirs(target_root, [Path(".imo"), Path("scripts"), Path("skills")])

    print(f"[imo install] uninstall complete: {target_root}")
    print(f"[imo install] files removed: {removed}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="imo install",
        description="Install IMO direct-run framework assets into a target repository.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for name, help_text in (
        ("init", "Install IMO into a target repository"),
        ("update", "Refresh managed IMO files in a target repository"),
    ):
        sub = subparsers.add_parser(name, help=help_text)
        sub.add_argument("target", nargs="?", default=".", help="Target repository path")
        sub.add_argument("--force", action="store_true", help="Overwrite user-modified managed files")
        sub.add_argument("--dry-run", action="store_true", help="Preview without writing files")
        sub.set_defaults(func=lambda args, update=name == "update": _install_or_update(args, update=update))

    uninstall = subparsers.add_parser("uninstall", help="Remove managed IMO files from a target repository")
    uninstall.add_argument("target", nargs="?", default=".", help="Target repository path")
    uninstall.add_argument("--force", action="store_true", help="Remove user-modified managed files too")
    uninstall.add_argument("--dry-run", action="store_true", help="Preview without removing files")
    uninstall.set_defaults(func=_uninstall)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
