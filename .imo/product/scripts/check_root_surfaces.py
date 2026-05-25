#!/usr/bin/env python3
"""Validate repo-root compatibility surfaces against IMO ownership contracts."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / ".imo/providers/root_surfaces.json"


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _as_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _repo_path(value: Any) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    return ROOT / value


def _link_target(path: Path) -> Path | None:
    if not path.is_symlink():
        return None
    target = Path(path.readlink())
    if not target.is_absolute():
        target = path.parent / target
    return target.resolve(strict=False)


def _target_parts_present(text: str, target: Path) -> bool:
    try:
        parts = target.relative_to(ROOT).parts
    except ValueError:
        return False
    return all(part in text for part in parts)


def _check_root_scripts(contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    entries = contract.get("root_scripts")
    if not isinstance(entries, list):
        return ["root_scripts must be a list"]

    actual_scripts = sorted(
        str(path.relative_to(ROOT))
        for path in (ROOT / "scripts").iterdir()
        if path.is_file() or path.is_symlink()
    )
    declared_scripts: list[str] = []

    for entry in entries:
        if not isinstance(entry, dict):
            errors.append("root_scripts entries must be objects")
            continue
        path = _repo_path(entry.get("path"))
        target = _repo_path(entry.get("target"))
        kind = entry.get("kind")
        if path is None or target is None:
            errors.append(f"invalid root script entry: {entry!r}")
            continue
        rel_path = str(path.relative_to(ROOT))
        declared_scripts.append(rel_path)
        if not path.exists():
            errors.append(f"{rel_path}: missing root script")
            continue
        if not target.exists():
            errors.append(f"{rel_path}: missing canonical target {target.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        target_literal = str(target.relative_to(ROOT))
        if kind == "shell-compat-exec":
            if "exec " not in text or target_literal not in text:
                errors.append(f"{rel_path}: shell wrapper must exec declared target {target_literal}")
        elif kind == "python-compat-runpy":
            if "runpy.run_path" not in text or not _target_parts_present(text, target):
                errors.append(f"{rel_path}: python runpy wrapper must forward to declared target {target_literal}")
        elif kind == "python-compat-import":
            if "importlib.util.spec_from_file_location" not in text or not _target_parts_present(text, target):
                errors.append(f"{rel_path}: python import wrapper must load declared target {target_literal}")
        else:
            errors.append(f"{rel_path}: invalid wrapper kind {kind!r}")
        if target_literal not in text and not _target_parts_present(text, target):
            errors.append(f"{rel_path}: wrapper does not reference declared target {target_literal}")

    undeclared = sorted(set(actual_scripts) - set(declared_scripts))
    if undeclared:
        errors.append(f"undeclared root script(s): {', '.join(undeclared)}")
    return errors


def _declared_external_paths(skill_surfaces: dict[str, Any]) -> set[str]:
    external = skill_surfaces.get("external")
    if not isinstance(external, list):
        return set()
    result: set[str] = set()
    for entry in external:
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            result.add(entry["path"].rstrip("/"))
    return result


def _check_external_entries(skill_surfaces: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    external = skill_surfaces.get("external")
    if not isinstance(external, list):
        return ["skill_surfaces.external must be a list"]
    for entry in external:
        if not isinstance(entry, dict):
            errors.append("external skill entries must be objects")
            continue
        path = _repo_path(entry.get("path"))
        provider = entry.get("provider")
        reason = entry.get("reason")
        if path is None:
            errors.append(f"external entry has invalid path: {entry!r}")
            continue
        rel = str(path.relative_to(ROOT))
        if provider != "market-skills":
            errors.append(f"{rel}: external provider must currently be market-skills")
        if not isinstance(reason, str) or not reason:
            errors.append(f"{rel}: external entry needs a reason")
        if not path.exists() and not path.is_symlink():
            errors.append(f"{rel}: declared external surface is missing")
    return errors


def _check_skill_surfaces(contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    skill_surfaces = contract.get("skill_surfaces")
    if not isinstance(skill_surfaces, dict):
        return ["skill_surfaces must be an object"]

    product_root = _repo_path(skill_surfaces.get("product_projection_root"))
    product_source = _repo_path(skill_surfaces.get("product_source_root"))
    runtime_root = _repo_path(skill_surfaces.get("runtime_projection_root"))
    runtime_source = _repo_path(skill_surfaces.get("runtime_source_root"))
    if product_root is None or product_source is None or runtime_root is None or runtime_source is None:
        return ["skill_surfaces roots must be non-empty strings"]

    for root_path, label in ((product_root, "product projection root"), (product_source, "product source root")):
        if not root_path.is_dir():
            errors.append(f"{label} missing: {root_path.relative_to(ROOT)}")

    external_paths = _declared_external_paths(skill_surfaces)
    errors.extend(_check_external_entries(skill_surfaces))

    product_modules = {
        path.name
        for path in product_source.iterdir()
        if path.is_dir()
    }

    for module in sorted(product_modules):
        root_module = product_root / module
        if not root_module.exists() and not root_module.is_symlink():
            errors.append(f"skills/{module}: missing root projection")
            continue
        for canonical_file in sorted((product_source / module).rglob("*")):
            if canonical_file.is_dir():
                continue
            rel = canonical_file.relative_to(product_source / module)
            projected_file = root_module / rel
            if not projected_file.exists() and not projected_file.is_symlink():
                errors.append(f"{projected_file.relative_to(ROOT)}: missing projection")
                continue
            link_target = _link_target(projected_file)
            if link_target is None:
                errors.append(f"{projected_file.relative_to(ROOT)}: projection must be a symlink")
            elif link_target != canonical_file.resolve(strict=False):
                errors.append(
                    f"{projected_file.relative_to(ROOT)}: points to {link_target}, expected {canonical_file.resolve(strict=False)}"
                )

    if runtime_root.exists() or runtime_root.is_symlink():
        expected_runtime_links = {
            runtime_root / "requirements.txt": runtime_source / "requirements.txt",
            runtime_root / "shared_runtime" / "__init__.py": runtime_source / "shared" / "__init__.py",
            runtime_root / "shared_runtime" / "agent_protocols.py": runtime_source / "shared" / "agent_protocols.py",
            runtime_root / "shared_runtime" / "graph_helpers.py": runtime_source / "shared" / "graph_helpers.py",
            runtime_root / "shared_runtime" / "types.py": runtime_source / "shared" / "types.py",
        }
        for projected, canonical in expected_runtime_links.items():
            if not projected.exists() and not projected.is_symlink():
                errors.append(f"{projected.relative_to(ROOT)}: missing runtime projection")
                continue
            link_target = _link_target(projected)
            if link_target != canonical.resolve(strict=False):
                errors.append(
                    f"{projected.relative_to(ROOT)}: points to {link_target}, expected {canonical.resolve(strict=False)}"
                )

    root_entries = {
        str(path.relative_to(ROOT)).rstrip("/")
        for path in product_root.iterdir()
        if path.name != ".DS_Store"
    }
    allowed_entries = {f"skills/{module}" for module in product_modules}
    allowed_entries.add("skills/migrated")
    allowed_entries.update(external_paths)
    unexpected = sorted(root_entries - allowed_entries)
    if unexpected:
        errors.append(f"unexpected root skill surface(s): {', '.join(unexpected)}")
    return errors


def _check_gitignore(contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    gitignore = ROOT / ".gitignore"
    try:
        lines = set(gitignore.read_text(encoding="utf-8").splitlines())
    except OSError as exc:
        return [f"failed to read .gitignore: {exc}"]
    gitignore_contract = contract.get("gitignore_contract")
    if not isinstance(gitignore_contract, dict):
        return ["gitignore_contract must be an object"]
    required = _as_string_list(gitignore_contract.get("allowed_root_whitelist"))
    if not required:
        errors.append("gitignore_contract.allowed_root_whitelist must be a non-empty list")
    for pattern in required:
        if pattern not in lines:
            errors.append(f".gitignore missing whitelist pattern: {pattern}")
    reason = gitignore_contract.get("reason")
    if not isinstance(reason, str) or "compatibility" not in reason:
        errors.append("gitignore_contract.reason must explain compatibility surface rationale")
    return errors


def main() -> int:
    try:
        contract = _load_json(CONTRACT_PATH)
    except OSError as exc:
        print(f"[root surfaces] failed to read {CONTRACT_PATH}: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"[root surfaces] invalid json in {CONTRACT_PATH}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(contract, dict):
        print("[root surfaces] failed: contract root must be an object", file=sys.stderr)
        return 1

    errors: list[str] = []
    if contract.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    errors.extend(_check_root_scripts(contract))
    errors.extend(_check_skill_surfaces(contract))
    errors.extend(_check_gitignore(contract))

    if errors:
        print("[root surfaces] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("[root surfaces] ok: scripts, skills, and gitignore compatibility surfaces are declared")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
