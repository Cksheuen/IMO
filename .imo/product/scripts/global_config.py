#!/usr/bin/env python3
"""Manage global IMO runtime shims."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import root_resolver


HOOK_REL = Path("hooks/codex-context.sh")
MANIFEST_REL = Path("install/managed-hashes.json")


def _hook_text() -> str:
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

exit 0
"""


def _block_hash(text: str) -> str:
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
    return None


def _load_manifest(global_root: Path) -> dict[str, Any]:
    manifest_path = global_root / MANIFEST_REL
    if not manifest_path.is_file():
        return {}
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _manifest(global_root: Path) -> dict[str, Any]:
    hook_hash = _block_hash(_hook_text())
    return {
        "schema_version": 1,
        "install_mode": "global",
        "global_root": str(global_root),
        "managed_files": [HOOK_REL.as_posix()],
        "files": {
            HOOK_REL.as_posix(): {
                "kind": "file",
                "hash": hook_hash,
                "executable": True,
            }
        },
    }


def _write_manifest(global_root: Path) -> None:
    manifest_path = global_root / MANIFEST_REL
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(_manifest(global_root), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _status(args: argparse.Namespace) -> int:
    global_root = Path(args.global_root).expanduser().resolve() if args.global_root else root_resolver.resolve_global_root()
    manifest_path = global_root / MANIFEST_REL
    hook_path = global_root / HOOK_REL
    print("IMO global status")
    print(f"global_root: {global_root}")
    print(f"manifest: {'present' if manifest_path.is_file() else 'missing'}")
    print(f"codex_context_hook: {'present' if hook_path.is_file() else 'missing'}")
    print(f"project_root: {root_resolver.resolve_project_root() or 'not detected'}")
    return 0


def _managed_hash(global_root: Path, relative: Path) -> str | None:
    files = _load_manifest(global_root).get("files")
    if not isinstance(files, dict):
        return None
    metadata = files.get(relative.as_posix())
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("hash")
    return value if isinstance(value, str) else None


def _is_safe_to_write(global_root: Path, relative: Path, desired_hash: str, *, force: bool) -> bool:
    target = global_root / relative
    current = _entry_hash(target)
    if current is None:
        return True
    if current == desired_hash:
        return True
    if current == _managed_hash(global_root, relative):
        return True
    return force


def _install(args: argparse.Namespace) -> int:
    global_root = Path(args.global_root).expanduser().resolve() if args.global_root else root_resolver.resolve_global_root()
    hook_path = global_root / HOOK_REL
    apply = bool(args.apply)
    action = "install" if args.command == "install" else "migrate"
    print(f"[imo global] {action} {'apply' if apply else 'dry-run'}: {global_root}")
    print(f"[imo global] would write: {hook_path}")
    print(f"[imo global] would write: {global_root / MANIFEST_REL}")
    if not apply:
        print("[imo global] pass --apply to write managed global shim files")
        return 0

    if not _is_safe_to_write(global_root, HOOK_REL, _block_hash(_hook_text()), force=bool(args.force)):
        print(f"[imo global] refused to overwrite unmanaged file: {hook_path}", file=sys.stderr)
        print("[imo global] re-run with --force to overwrite", file=sys.stderr)
        return 1

    hook_path.parent.mkdir(parents=True, exist_ok=True)
    if hook_path.is_symlink() or hook_path.is_file():
        hook_path.unlink()
    hook_path.write_text(_hook_text(), encoding="utf-8")
    hook_path.chmod(0o755)
    _write_manifest(global_root)
    print(f"[imo global] {action} complete")
    return 0


def _uninstall(args: argparse.Namespace) -> int:
    global_root = Path(args.global_root).expanduser().resolve() if args.global_root else root_resolver.resolve_global_root()
    manifest_path = global_root / MANIFEST_REL
    hook_path = global_root / HOOK_REL
    apply = bool(args.apply)
    print(f"[imo global] uninstall {'apply' if apply else 'dry-run'}: {global_root}")
    for path in (hook_path, manifest_path):
        print(f"[imo global] would remove: {path}")
    if not apply:
        print("[imo global] pass --apply to remove managed global shim files")
        return 0
    if not _is_safe_to_write(global_root, HOOK_REL, _block_hash(_hook_text()), force=bool(args.force)):
        print(f"[imo global] refused to remove unmanaged file: {hook_path}", file=sys.stderr)
        print("[imo global] re-run with --force to remove it", file=sys.stderr)
        return 1
    for path in (hook_path, manifest_path):
        if path.exists() or path.is_symlink():
            path.unlink()
    for directory in (hook_path.parent, manifest_path.parent):
        try:
            directory.rmdir()
        except OSError:
            pass
    print("[imo global] uninstall complete")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage global IMO runtime shims.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command, handler in (
        ("status", _status),
        ("install", _install),
        ("migrate", _install),
        ("uninstall", _uninstall),
    ):
        sub = subparsers.add_parser(command)
        sub.add_argument("--global-root", help="Override global IMO root; defaults to IMO_GLOBAL_ROOT or ~/.imo")
        if command != "status":
            sub.add_argument("--apply", action="store_true", help="Write changes. Omit for dry-run.")
            sub.add_argument("--force", action="store_true", help="Overwrite or remove unmanaged shim files.")
        sub.set_defaults(func=handler)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
