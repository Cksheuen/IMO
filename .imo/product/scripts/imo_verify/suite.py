from __future__ import annotations

import sys

from .learning_smokes import (
    _run_learning_candidate_smoke,
    _run_learning_context_smoke,
    _run_learning_deferred_review_smoke,
    _run_learning_digest_smoke,
    _run_learning_signal_smoke,
    _run_learning_telemetry_smoke,
)
from .other_smokes import _run_defensive_audit_smoke, _run_project_profile_smoke
from .runner import run_check
from .static_contracts import build_static_checks


def main() -> int:
    failures = 0
    for label, command, env in build_static_checks():
        if not run_check(label, command, env=env):
            failures += 1

    smoke_checks = [
        _run_learning_signal_smoke,
        _run_defensive_audit_smoke,
        _run_learning_candidate_smoke,
        _run_learning_digest_smoke,
        _run_learning_context_smoke,
        _run_learning_deferred_review_smoke,
        _run_learning_telemetry_smoke,
        _run_project_profile_smoke,
    ]
    for smoke_check in smoke_checks:
        if not smoke_check():
            failures += 1

    if failures:
        print(f"[imo verify] {failures} check(s) failed", file=sys.stderr)
        return 1
    print("[imo verify] all checks passed")
    return 0
