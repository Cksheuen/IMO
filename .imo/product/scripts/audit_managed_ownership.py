#!/usr/bin/env python3
"""Audit overlap between IMO-managed host outputs and Trellis template tracking."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PREFIX_BY_PLATFORM = {
    "claude": ".claude/",
    "codex": ".codex/",
}

CATEGORY_LABELS = {
    "managed_files": "managed file",
    "json_merges": "json merge",
    "toml_blocks": "toml block",
}


class AuditError(RuntimeError):
    """Raised when ownership audit inputs are invalid."""


@dataclass(frozen=True)
class ManifestTarget:
    platform: str
    category: str
    source: str
    target: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AuditError(f"{path}: file not found") from exc
    except json.JSONDecodeError as exc:
        raise AuditError(f"{path}: invalid JSON ({exc})") from exc


def parse_manifest(root: Path, platform: str) -> list[ManifestTarget]:
    manifest_path = root / ".imo" / "adapters" / platform / "manifest.json"
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict):
        raise AuditError(f"{manifest_path}: manifest must be a JSON object")

    targets: list[ManifestTarget] = []
    for key, label in CATEGORY_LABELS.items():
        entries = manifest.get(key, [])
        if entries is None:
            continue
        if not isinstance(entries, list):
            raise AuditError(f"{manifest_path}: `{key}` must be a list")
        for entry in entries:
            if not isinstance(entry, dict):
                raise AuditError(f"{manifest_path}: `{key}` entries must be objects")
            source = entry.get("source")
            target = entry.get("target")
            if not isinstance(source, str) or not isinstance(target, str):
                raise AuditError(
                    f"{manifest_path}: `{key}` entries require string `source` and `target`",
                )
            targets.append(
                ManifestTarget(
                    platform=platform,
                    category=label,
                    source=source,
                    target=target,
                ),
            )
    return targets


def load_trellis_hashes(root: Path, platforms: list[str]) -> dict[str, str]:
    template_hashes_path = root / ".trellis" / ".template-hashes.json"
    if not template_hashes_path.exists():
        return {}
    data = load_json(template_hashes_path)
    if not isinstance(data, dict):
        raise AuditError(f"{template_hashes_path}: template hash file must be a JSON object")

    raw_hashes = data.get("hashes")
    if not isinstance(raw_hashes, dict):
        raise AuditError(f"{template_hashes_path}: `hashes` must be an object")

    prefixes = tuple(PREFIX_BY_PLATFORM[platform] for platform in platforms)
    return {
        str(path): str(file_hash)
        for path, file_hash in raw_hashes.items()
        if isinstance(path, str)
        and isinstance(file_hash, str)
        and path.startswith(prefixes)
    }


def load_imo_managed_hashes(root: Path) -> dict[str, str]:
    state_path = root / ".imo" / ".runtime" / "managed-hashes.json"
    try:
        data = load_json(state_path)
    except AuditError:
        return {}

    if not isinstance(data, dict):
        return {}
    raw_hashes = data.get("managed_files")
    if not isinstance(raw_hashes, dict):
        return {}
    return {
        str(path): str(file_hash)
        for path, file_hash in raw_hashes.items()
        if isinstance(path, str) and isinstance(file_hash, str)
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit overlap between IMO-managed host outputs and Trellis template tracking.",
    )
    parser.add_argument(
        "target",
        nargs="?",
        default="all",
        choices=("all", "claude", "codex"),
        help="Which host surface to audit",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    platforms = ["claude", "codex"] if args.target == "all" else [args.target]
    root = repo_root()

    try:
        targets = [
            target
            for platform in platforms
            for target in parse_manifest(root, platform)
        ]
        trellis_hashes = load_trellis_hashes(root, platforms)
        imo_hashes = load_imo_managed_hashes(root)
    except AuditError as exc:
        print(f"imo audit: {exc}", file=sys.stderr)
        return 2

    overlaps = [target for target in targets if target.target in trellis_hashes]
    full_file_overlap = [
        target for target in overlaps if target.category == CATEGORY_LABELS["managed_files"]
    ]
    partial_overlap = [target for target in overlaps if target not in full_file_overlap]

    print("imo audit: host ownership report")
    print(f"- target scope: {', '.join(platforms)}")
    print(f"- manifest targets scanned: {len(targets)}")
    print(f"- Trellis-tracked host outputs scanned: {len(trellis_hashes)}")
    print(f"- overlapping host outputs: {len(overlaps)}")

    if not overlaps:
        print("- no IMO/Trellis host ownership overlap detected")
        return 0

    print("")
    print(
        "These host outputs are listed in IMO manifests but still tracked by "
        "Trellis template hashes. Treat `.imo` sources as the edit surface."
    )

    for target in overlaps:
        print(f"- {target.target} [{target.platform}, {target.category}]")
        print(f"  source: {target.source}")
        if target.category == CATEGORY_LABELS["managed_files"]:
            imo_hash = imo_hashes.get(target.target)
            if imo_hash is None:
                print("  drift state: full-file target is missing from IMO managed hashes")
            elif imo_hash == trellis_hashes[target.target]:
                print("  drift state: IMO and Trellis both track this full-file target (hashes match)")
            else:
                print("  drift state: IMO and Trellis both track this full-file target (hashes differ)")
        else:
            print("  drift state: Trellis tracks the whole host file while IMO manages a fragment")

    print("")
    print("Summary:")
    print(f"- full-file overlaps: {len(full_file_overlap)}")
    print(f"- partial overlaps: {len(partial_overlap)}")
    print("- next action: edit `.imo` source assets, not generated `.claude` / `.codex` files")
    print("- next action: remove migrated host outputs from Trellis template ownership upstream")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
