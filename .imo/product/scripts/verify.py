#!/usr/bin/env python3
"""Run the repo-local IMO verification suite."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[3]
PYCACHE_PREFIX = Path(os.environ.get("PYTHONPYCACHEPREFIX", "/private/tmp/cc-codex-framework-pycache"))


def _run(label: str, command: list[str], *, env: dict[str, str] | None = None) -> bool:
    print(f"[imo verify] {label}")
    result = subprocess.run(command, cwd=ROOT, env=env, check=False)
    if result.returncode == 0:
        print(f"[imo verify] ok: {label}")
        return True
    print(f"[imo verify] failed ({result.returncode}): {label}", file=sys.stderr)
    return False


def _python_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONPYCACHEPREFIX"] = str(PYCACHE_PREFIX)
    return env


def main() -> int:
    python_env = _python_env()
    checks = [
        (
            "host ownership audit",
            ["bash", "scripts/imo.sh", "audit", "all"],
            None,
        ),
        (
            "root entry help",
            ["bash", "scripts/imo.sh", "--help"],
            None,
        ),
        (
            "shell wrapper syntax",
            ["bash", "-n", "scripts/imo.sh"],
            None,
        ),
        (
            "canonical shell syntax",
            ["bash", "-n", ".imo/product/scripts/imo.sh"],
            None,
        ),
        (
            "module metadata contract",
            [sys.executable, ".imo/product/scripts/check_module_metadata.py"],
            python_env,
        ),
        (
            "learning contract policy",
            [sys.executable, ".imo/product/scripts/check_learning_contracts.py"],
            python_env,
        ),
        (
            "provider contract registry",
            [sys.executable, ".imo/product/scripts/check_provider_contracts.py"],
            python_env,
        ),
        (
            "python script compile",
            [
                sys.executable,
                "-m",
                "py_compile",
                ".imo/product/scripts/audit_managed_ownership.py",
                ".imo/product/scripts/audit_runtime_links_core.py",
                ".imo/product/scripts/check_learning_contracts.py",
                ".imo/product/scripts/check-langchain-runtime-deps.py",
                ".imo/product/scripts/check_module_metadata.py",
                ".imo/product/scripts/check_provider_contracts.py",
                ".imo/product/scripts/task-audit.py",
                ".imo/product/scripts/verify.py",
                "scripts/audit_runtime_links_core.py",
                "scripts/check-langchain-runtime-deps.py",
                "scripts/task-audit.py",
            ],
            python_env,
        ),
        (
            "runtime-link compatibility import",
            [
                sys.executable,
                "-c",
                "import scripts.audit_runtime_links_core as m; assert callable(m.summarize)",
            ],
            python_env,
        ),
        (
            "shared runtime compatibility import",
            [
                sys.executable,
                "-c",
                "import skills.migrated.shared_runtime as s; assert hasattr(s, 'build_delta_context')",
            ],
            python_env,
        ),
    ]

    failures = 0
    for label, command, env in checks:
        if not _run(label, command, env=env):
            failures += 1

    if failures:
        print(f"[imo verify] {failures} check(s) failed", file=sys.stderr)
        return 1
    print("[imo verify] all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
