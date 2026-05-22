from __future__ import annotations

import os
import sys

from .global_project_smokes import _run_global_project_scope_smoke
from .install_smokes import _run_install_smoke
from .learning_smokes import (
    _run_learning_candidate_smoke,
    _run_learning_context_smoke,
    _run_learning_deferred_review_smoke,
    _run_learning_digest_smoke,
    _run_learning_signal_smoke,
    _run_learning_telemetry_smoke,
)
from .observability_smokes import _run_observability_smoke
from .orchestrate_smoke import run_orchestrate_runtime_smoke
from .other_smokes import _run_defensive_audit_smoke, _run_project_profile_smoke
from .package_smokes import _run_package_smoke
from .runner import run_check
from .static_contracts import build_static_checks
from .task_graph_smokes import _run_task_graph_smoke


def _with_observability_events_disabled(callback) -> bool:
    previous_observability = os.environ.get("IMO_DISABLE_OBSERVABILITY_EVENTS")
    os.environ["IMO_DISABLE_OBSERVABILITY_EVENTS"] = "1"
    try:
        return callback()
    finally:
        if previous_observability is None:
            os.environ.pop("IMO_DISABLE_OBSERVABILITY_EVENTS", None)
        else:
            os.environ["IMO_DISABLE_OBSERVABILITY_EVENTS"] = previous_observability


def _with_observability_events_enabled(callback) -> bool:
    previous = os.environ.get("IMO_DISABLE_EVENTS")
    previous_observability = os.environ.get("IMO_DISABLE_OBSERVABILITY_EVENTS")
    os.environ.pop("IMO_DISABLE_EVENTS", None)
    os.environ.pop("IMO_DISABLE_OBSERVABILITY_EVENTS", None)
    try:
        return callback()
    finally:
        if previous is None:
            os.environ.pop("IMO_DISABLE_EVENTS", None)
        else:
            os.environ["IMO_DISABLE_EVENTS"] = previous
        if previous_observability is None:
            os.environ.pop("IMO_DISABLE_OBSERVABILITY_EVENTS", None)
        else:
            os.environ["IMO_DISABLE_OBSERVABILITY_EVENTS"] = previous_observability


def main() -> int:
    failures = 0
    for label, command, env in build_static_checks():
        check = lambda label=label, command=command, env=env: run_check(label, command, env=env)
        if not _with_observability_events_disabled(check):
            failures += 1

    smoke_checks = [
        run_orchestrate_runtime_smoke,
        _run_learning_signal_smoke,
        _run_defensive_audit_smoke,
        _run_learning_candidate_smoke,
        _run_learning_digest_smoke,
        _run_learning_context_smoke,
        _run_learning_deferred_review_smoke,
        _run_learning_telemetry_smoke,
        _run_observability_smoke,
        _run_task_graph_smoke,
        _run_project_profile_smoke,
        _run_package_smoke,
        _run_global_project_scope_smoke,
    ]
    if os.environ.get("IMO_VERIFY_SKIP_INSTALL_SMOKE") != "1":
        smoke_checks.append(_run_install_smoke)
    for smoke_check in smoke_checks:
        if smoke_check is _run_observability_smoke:
            passed = _with_observability_events_enabled(smoke_check)
        else:
            passed = _with_observability_events_disabled(smoke_check)
        if not passed:
            failures += 1

    if failures:
        print(f"[imo verify] {failures} check(s) failed", file=sys.stderr)
        return 1
    print("[imo verify] all checks passed")
    return 0
