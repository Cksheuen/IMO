#!/usr/bin/env python3
"""Check mandatory LangChain/LangGraph dependencies for migrated runtimes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SHARED_REQUIREMENTS = ROOT / "skills" / "migrated" / "requirements.txt"
DEFAULT_PYTHON = ROOT / ".venv" / "bin" / "python"
RUNTIME_REQUIREMENTS = {
    "multi-model-agent": ROOT / "skills" / "multi-model-agent" / "migrated" / "requirements.txt",
    "orchestrate": ROOT / "skills" / "orchestrate" / "migrated" / "requirements.txt",
    "dual-review-loop": ROOT / "skills" / "dual-review-loop" / "migrated" / "requirements.txt",
    "promote-notes": ROOT / "skills" / "promote-notes" / "migrated" / "requirements.txt",
    "self-verification": SHARED_REQUIREMENTS,
}
REQUIRED_MODULES = ("langgraph", "langchain", "langchain_core")


def module_status(python_executable: Path) -> tuple[list[str], list[str], list[str]]:
    installed: list[str] = []
    missing: list[str] = []
    notes: list[str] = []

    if not python_executable.exists():
        return installed, list(REQUIRED_MODULES), [f"python interpreter not found: {python_executable}"]

    for module in REQUIRED_MODULES:
        result = subprocess.run(
            [str(python_executable), "-c", f"import {module}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode == 0:
            installed.append(module)
        else:
            missing.append(module)

    return installed, missing, notes


def build_report(runtime: str, python_executable: Path) -> dict:
    installed, missing, notes = module_status(python_executable)
    requirements_file = RUNTIME_REQUIREMENTS.get(runtime, SHARED_REQUIREMENTS)
    install_command = f"./.venv/bin/pip install -r {requirements_file}"
    return {
        "runtime": runtime,
        "ok": not missing,
        "python_executable": str(python_executable),
        "installed_modules": installed,
        "missing_modules": missing,
        "requirements_file": str(requirements_file),
        "shared_requirements_file": str(SHARED_REQUIREMENTS),
        "install_command": install_command,
        "notes": notes + [
            "Use the repo-local virtualenv only; do not install these dependencies globally.",
            "If pip/network is blocked but the current task requires running the migrated runtime, request escalation and rerun the install command.",
        ],
    }


def print_text(report: dict) -> None:
    print("LangChain Migrated Runtime Dependency Check")
    print(f"Runtime: {report['runtime']}")
    print(f"Python: {report['python_executable']}")
    print(f"Requirements: {report['requirements_file']}")
    print(f"Installed: {', '.join(report['installed_modules']) or 'none'}")
    print(f"Missing: {', '.join(report['missing_modules']) or 'none'}")
    print(f"Install command: {report['install_command']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check LangChain/LangGraph dependencies for migrated runtimes.")
    parser.add_argument(
        "--runtime",
        default="all",
        choices=["all", *sorted(RUNTIME_REQUIREMENTS.keys())],
        help="Migrated runtime name. Use 'all' for the shared dependency set.",
    )
    parser.add_argument(
        "--python",
        default=str(DEFAULT_PYTHON),
        help="Python interpreter to check. Defaults to the repo-local .venv interpreter.",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON output.")
    args = parser.parse_args()

    report = build_report(args.runtime, Path(args.python).expanduser())
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text(report)
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
