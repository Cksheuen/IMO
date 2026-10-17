#!/usr/bin/env python3
"""Check SKILL.md semantic dependencies for enabled modules."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

SCHEMA_VERSION = 1
MODULES_REL = Path(".imo/product/skills/modules.json")
PROVIDERS_REL = Path(".imo/providers/registry.json")

EXTERNAL_RE = re.compile(
    r"~/.claude(?:/[A-Za-z0-9._/-]*)?"
    r"|\$HOME/.claude(?:/[A-Za-z0-9._/-]*)?"
    r"|\$\{HOME\}/.claude(?:/[A-Za-z0-9._/-]*)?"
)
SKILL_DIR_RE = re.compile(r"<skill-dir>/scripts/([A-Za-z0-9._/-]+)")
REL_SCRIPT_RE = re.compile(
    r"(?:^|(?<=[\s`'\"(]))scripts/([A-Za-z0-9._/-]+)", re.MULTILINE
)


def issue(severity: str, code: str, message: str) -> Dict[str, str]:
    return {"severity": severity, "code": code, "message": message}


def clean_ref(value: str) -> str:
    return value.rstrip(".,;:!?")


def display_path(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def external_to_path(raw: str, home: Path) -> Path:
    if raw.startswith("~"):
        rel = raw[1:]
    elif raw.startswith("${HOME}"):
        rel = raw[len("${HOME}") :]
    else:
        rel = raw[len("$HOME") :]
    return home / rel.lstrip("/")


def is_nonrequired_reference(raw: str, path: Path) -> bool:
    """Return true for examples or runtime data, not provider prerequisites."""
    return "YYYY" in raw or path.suffix == ".jsonl"


def scan_skill(
    text: str, surface: Path, home: Path
) -> Tuple[Dict[str, Path], Dict[str, Path]]:
    external: Dict[str, Path] = {}
    local: Dict[str, Path] = {}

    for match in EXTERNAL_RE.finditer(text):
        raw = clean_ref(match.group(0))
        if raw:
            external[raw] = external_to_path(raw, home)

    for match in SKILL_DIR_RE.finditer(text):
        ref = clean_ref(match.group(1))
        if ref:
            local[ref] = surface / "scripts" / ref

    for match in REL_SCRIPT_RE.finditer(text):
        ref = clean_ref(match.group(1))
        if ref and ref not in local:
            local[ref] = surface / "scripts" / ref

    return external, local


def normalize_dependencies(value: Any) -> List[Any]:
    deps = value or []
    if not isinstance(deps, list):
        deps = [deps]
    if deps and all(isinstance(dep, str) for dep in deps):
        deps = sorted(deps)
    return deps


def check_module(
    module: Dict[str, Any], root: Path, home: Path, cli_dependencies: set[str]
) -> Dict[str, Any]:
    module_id = str(module.get("id", "") or "<unknown>")
    classification = str(module.get("classification", "") or "")
    deps = normalize_dependencies(module.get("external_dependencies"))

    owner_surface = module.get("owner_surface")
    surface = root / str(owner_surface) if owner_surface else root
    skill_path = surface / "SKILL.md"

    issues: List[Dict[str, str]] = []
    external: Dict[str, Path] = {}
    local: Dict[str, Path] = {}

    if not skill_path.exists():
        issues.append(
            issue(
                "error",
                "skill_missing",
                f"missing SKILL.md: {display_path(skill_path, root)}",
            )
        )
    else:
        try:
            text = skill_path.read_text(encoding="utf-8")
        except OSError as exc:
            text = ""
            issues.append(
                issue(
                    "error",
                    "skill_unreadable",
                    f"cannot read {display_path(skill_path, root)}: {exc}",
                )
            )
        external, local = scan_skill(text, surface, home)

    local_refs: List[str] = []
    for ref in sorted(local):
        path = local[ref]
        try:
            path.resolve().relative_to(surface.resolve())
        except ValueError:
            local_refs.append(display_path(path, root))
            issues.append(
                issue(
                    "error",
                    "invalid_local_script_reference",
                    f"scripts/{ref} resolves outside owner_surface",
                )
            )
            continue

        local_refs.append(display_path(path, root))
        if not path.exists():
            issues.append(
                issue(
                    "error",
                    "local_script_missing",
                    f"missing local script: {display_path(path, root)}",
                )
            )

    required_external = {
        ref: path
        for ref, path in external.items()
        if not is_nonrequired_reference(ref, path)
    }
    nonrequired_external = sorted(set(external) - set(required_external))

    for ref in sorted(external):
        path = external[ref]
        if classification == "native":
            issues.append(
                issue(
                    "error",
                    "native_external_reference",
                    f"native module references external path: {ref}",
                )
            )
        if not deps:
            issues.append(
                issue(
                    "error",
                    "external_dependency_undeclared",
                    f"external reference {ref} but external_dependencies is empty",
                )
            )
        if (
            classification == "provider-backed"
            and ref in required_external
            and not path.exists()
        ):
            issues.append(
                issue(
                    "warning",
                    "provider_path_missing",
                    f"provider path not found: {path}",
                )
            )

    required_commands = [dep for dep in deps if isinstance(dep, str) and dep in cli_dependencies]
    missing_commands = [command for command in required_commands if shutil.which(command) is None]
    if classification == "provider-backed":
        for command in missing_commands:
            issues.append(issue("warning", "provider_command_missing",
                                f"provider command not found on PATH: {command}"))

    if classification == "provider-backed" and (required_external or required_commands):
        provider_status = (
            "available"
            if all(path.exists() for path in required_external.values()) and not missing_commands
            else "unavailable"
        )
    else:
        provider_status = "not_applicable"

    issues.sort(key=lambda item: (item["code"], item["message"]))

    return {
        "id": module_id,
        "classification": classification,
        "external_references": sorted(external),
        "nonrequired_external_references": nonrequired_external,
        "local_script_references": local_refs,
        "external_dependencies": deps,
        "provider_status": provider_status,
        "issues": issues,
    }


def build_report(root: Path, home: Path) -> Dict[str, Any]:
    modules_path = root / MODULES_REL
    try:
        raw = json.loads(modules_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: cannot load {modules_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    if isinstance(raw, dict):
        entries = raw.get("modules", [])
    elif isinstance(raw, list):
        entries = raw
    else:
        entries = []

    providers_path = root / PROVIDERS_REL
    try:
        registry = json.loads(providers_path.read_text(encoding="utf-8"))
        cli_dependencies = {
            provider["id"] for provider in registry["providers"]
            if "PATH" in provider.get("discovery", {}).get("inputs", [])
        }
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        print(f"error: cannot load providers from {providers_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    enabled = [
        entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("default_enabled")
    ]
    enabled.sort(key=lambda entry: str(entry.get("id", "") or ""))

    modules = [check_module(entry, root, home, cli_dependencies) for entry in enabled]
    errors = sum(
        1
        for module in modules
        for item in module["issues"]
        if item["severity"] == "error"
    )
    warnings = sum(
        1
        for module in modules
        for item in module["issues"]
        if item["severity"] == "warning"
    )
    unavailable = sum(
        1 for module in modules if module["provider_status"] == "unavailable"
    )

    return {
        "schema_version": SCHEMA_VERSION,
        "root": str(root),
        "modules": modules,
        "summary": {
            "errors": errors,
            "warnings": warnings,
            "unavailable": unavailable,
        },
    }


def print_human(report: Dict[str, Any]) -> None:
    for module in report["modules"]:
        if module["issues"]:
            print(f"{module['id']} ({module['classification']})")
            for item in module["issues"]:
                print(
                    f"  {item['severity'].upper()} {item['code']}: {item['message']}"
                )
    summary = report["summary"]
    print(
        "checked {} modules; errors={} warnings={} unavailable={}".format(
            len(report["modules"]),
            summary["errors"],
            summary["warnings"],
            summary["unavailable"],
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check SKILL.md dependencies for enabled modules."
    )
    parser.add_argument("--json", action="store_true", help="emit JSON output")
    parser.add_argument(
        "--root", type=Path, default=Path.cwd(), help="repository root"
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=None,
        help="HOME used to resolve ~ and $HOME without modifying environment",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    home = args.home.expanduser().resolve() if args.home else Path.home()

    report = build_report(root, home)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_human(report)

    return 1 if report["summary"]["errors"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
