from __future__ import annotations

import sys

from .runner import no_event_env, python_env


def build_static_checks() -> list[tuple[str, list[str], dict[str, str] | None]]:
    py_env = python_env()
    no_events_env = no_event_env()
    return [
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
            "direct root entry help",
            ["./imo", "--help"],
            None,
        ),
        (
            "direct root entry syntax",
            ["bash", "-n", "imo"],
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
            py_env,
        ),
        (
            "rule contracts",
            [sys.executable, ".imo/product/scripts/check_rule_contracts.py"],
            py_env,
        ),
        (
            "learning contract policy",
            [sys.executable, ".imo/product/scripts/check_learning_contracts.py"],
            py_env,
        ),
        (
            "project profile contracts",
            [sys.executable, ".imo/product/scripts/check_project_profile_contracts.py"],
            py_env,
        ),
        (
            "provider contract registry",
            [sys.executable, ".imo/product/scripts/check_provider_contracts.py"],
            py_env,
        ),
        (
            "root compatibility surfaces",
            [sys.executable, ".imo/product/scripts/check_root_surfaces.py"],
            py_env,
        ),
        (
            "learning read-only list",
            ["bash", "scripts/imo.sh", "learning", "list"],
            None,
        ),
        (
            "codex context hook",
            ["./imo", "codex", "context", "--empty"],
            no_events_env,
        ),
        (
            "python script compile",
            [
                sys.executable,
                "-m",
                "py_compile",
                ".imo/product/scripts/audit_managed_ownership.py",
                ".imo/product/scripts/audit_runtime_links_core.py",
                ".imo/product/scripts/codex_context.py",
                ".imo/product/scripts/defensive_audit.py",
                ".imo/product/scripts/learning_events.py",
                ".imo/product/scripts/check_learning_contracts.py",
                ".imo/product/scripts/check-langchain-runtime-deps.py",
                ".imo/product/scripts/check_module_metadata.py",
                ".imo/product/scripts/check_project_profile_contracts.py",
                ".imo/product/scripts/check_provider_contracts.py",
                ".imo/product/scripts/check_rule_contracts.py",
                ".imo/product/scripts/check_root_surfaces.py",
                ".imo/product/scripts/learning.py",
                ".imo/product/scripts/project_profile.py",
                ".imo/product/scripts/task-audit.py",
                ".imo/product/scripts/verify.py",
                ".imo/product/scripts/imo_verify/__init__.py",
                ".imo/product/scripts/imo_verify/learning_smokes.py",
                ".imo/product/scripts/imo_verify/other_smokes.py",
                ".imo/product/scripts/imo_verify/runner.py",
                ".imo/product/scripts/imo_verify/static_contracts.py",
                ".imo/product/scripts/imo_verify/suite.py",
                "scripts/audit_runtime_links_core.py",
                "scripts/check-langchain-runtime-deps.py",
                "scripts/task-audit.py",
            ],
            py_env,
        ),
        (
            "runtime-link compatibility import",
            [
                sys.executable,
                "-c",
                "import scripts.audit_runtime_links_core as m; assert callable(m.summarize)",
            ],
            py_env,
        ),
        (
            "shared runtime compatibility import",
            [
                sys.executable,
                "-c",
                "import skills.migrated.shared_runtime as s; assert hasattr(s, 'build_delta_context')",
            ],
            py_env,
        ),
    ]

