from __future__ import annotations

import sys

from .runner import no_event_env, python_env


def build_static_checks() -> list[tuple[str, list[str], dict[str, str] | None]]:
    py_env = python_env()
    no_events_env = no_event_env()
    return [
        (
            "context budget audit",
            ["./imo", "budget", "audit", "--json"],
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
            "skill semantic contract",
            [sys.executable, ".imo/product/scripts/check_skill_semantics.py", "--json"],
            py_env,
        ),
        (
            "tracked reference contract",
            [sys.executable, ".imo/product/scripts/check_tracked_references.py", "--json"],
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
            "identity veil contracts",
            [sys.executable, ".imo/product/scripts/check_identity_veil_contracts.py"],
            py_env,
        ),
        (
            "observability contracts",
            [sys.executable, ".imo/product/scripts/check_observability_contracts.py"],
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
                ".imo/product/scripts/audit_runtime_links_core.py",
                ".imo/product/scripts/budget_audit.py",
                ".imo/product/scripts/codex_context.py",
                ".imo/product/scripts/defensive_audit.py",
                ".imo/product/scripts/global_config.py",
                ".imo/product/scripts/install.py",
                ".imo/product/scripts/learning_events.py",
                ".imo/product/scripts/learning_common.py",
                ".imo/product/scripts/learning_signals.py",
                ".imo/product/scripts/learning_candidates.py",
                ".imo/product/scripts/learning_digest.py",
                ".imo/product/scripts/learning_profile.py",
                ".imo/product/scripts/learning_review.py",
                ".imo/product/scripts/check_learning_contracts.py",
                ".imo/product/scripts/check-langchain-runtime-deps.py",
                ".imo/product/scripts/check_module_metadata.py",
                ".imo/product/scripts/check_observability_contracts.py",
                ".imo/product/scripts/check_project_profile_contracts.py",
                ".imo/product/scripts/check_identity_veil_contracts.py",
                ".imo/product/scripts/identity_veil.py",
                ".imo/product/scripts/check_provider_contracts.py",
                ".imo/product/scripts/check_rule_contracts.py",
                ".imo/product/scripts/check_root_surfaces.py",
                ".imo/product/scripts/check_skill_semantics.py",
                ".imo/product/scripts/check_tracked_references.py",
                ".imo/product/scripts/learning.py",
                ".imo/product/scripts/metrics.py",
                ".imo/product/scripts/observability_events.py",
                ".imo/product/scripts/project_profile.py",
                ".imo/product/scripts/root_resolver.py",
                ".imo/product/scripts/verify.py",
                ".imo/product/scripts/imo_verify/__init__.py",
                ".imo/product/scripts/imo_verify/global_project_smokes.py",
                ".imo/product/scripts/imo_verify/global_config_smoke.py",
                ".imo/product/scripts/imo_verify/install_smokes.py",
                ".imo/product/scripts/imo_verify/learning_smokes.py",
                ".imo/product/scripts/imo_verify/learning_signal_smoke.py",
                ".imo/product/scripts/imo_verify/learning_candidate_smoke.py",
                ".imo/product/scripts/imo_verify/learning_digest_smoke.py",
                ".imo/product/scripts/imo_verify/learning_context_smoke.py",
                ".imo/product/scripts/imo_verify/learning_user_profile_smoke.py",
                ".imo/product/scripts/imo_verify/learning_deferred_review_smoke.py",
                ".imo/product/scripts/imo_verify/learning_telemetry_smoke.py",
                ".imo/product/scripts/imo_verify/observability_smokes.py",
                ".imo/product/scripts/imo_verify/orchestrate_smoke.py",
                ".imo/product/scripts/imo_verify/identity_veil_smoke.py",
                ".imo/product/scripts/imo_verify/other_smokes.py",
                ".imo/product/scripts/imo_verify/package_smokes.py",
                ".imo/product/scripts/imo_verify/runner.py",
                ".imo/product/scripts/imo_verify/skill_semantics_smoke.py",
                ".imo/product/scripts/imo_verify/tracked_references_smoke.py",
                ".imo/product/scripts/imo_verify/static_contracts.py",
                ".imo/product/scripts/imo_verify/suite.py",
                "scripts/audit_runtime_links_core.py",
                "scripts/check-langchain-runtime-deps.py",
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
