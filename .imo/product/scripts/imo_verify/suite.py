from __future__ import annotations

import os
import sys

from observability_events import new_span_id, new_trace_id, now_ms, write_event

from .architecture_health_smoke import _run_architecture_health_smoke
from .evolve_notes_smoke import _run_evolve_notes_smoke
from .global_config_smoke import _run_global_config_smoke
from .global_project_smokes import _run_global_project_scope_smoke
from .install_smokes import _run_install_smoke, _run_root_resolver_smoke
from .learning_smokes import (
    _run_learning_candidate_smoke,
    _run_learning_context_smoke,
    _run_learning_deferred_review_smoke,
    _run_learning_digest_smoke,
    _run_learning_signal_smoke,
    _run_learning_telemetry_smoke,
    _run_learning_user_profile_smoke,
)
from .observability_smokes import _run_observability_smoke
from .orchestrate_smoke import run_orchestrate_runtime_smoke
from .identity_veil_smoke import run_identity_veil_smoke
from .other_smokes import (
    _run_budget_audit_smoke,
    _run_defensive_audit_smoke,
    _run_project_profile_smoke,
)
from .package_smokes import _run_package_smoke
from .runner import isolated_fixture_runtime, run_check
from .skill_semantics_smoke import _run_skill_semantics_smoke
from .tracked_references_smoke import _run_tracked_references_smoke
from .static_contracts import build_static_checks


def _run_verify_check(label: str, callback, trace_id: str, parent_span_id: str) -> bool:
    span_id = new_span_id()
    start_ms = now_ms()
    write_event(
        "verify_check_start",
        plane="verify",
        component="imo_verify",
        operation="check",
        phase="start",
        trace_id=trace_id,
        span_id=span_id,
        parent_span_id=parent_span_id,
        check_label=label,
    )

    passed = False
    try:
        passed = bool(callback())
        return passed
    finally:
        write_event(
            "verify_check_end",
            plane="verify",
            component="imo_verify",
            operation="check",
            phase="end",
            trace_id=trace_id,
            span_id=span_id,
            parent_span_id=parent_span_id,
            check_label=label,
            outcome="ok" if passed else "error",
            duration_ms=now_ms() - start_ms,
            status="passed" if passed else "failed",
        )


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


def _execute_suite(trace_id: str, parent_span_id: str) -> int:
    failures = 0
    for label, command, env in build_static_checks():
        check = lambda label=label, command=command, env=env: run_check(label, command, env=env)
        if not _run_verify_check(label, check, trace_id, parent_span_id):
            failures += 1

    smoke_checks = [
        _run_architecture_health_smoke,
        _run_evolve_notes_smoke,
        _run_global_config_smoke,
        _run_skill_semantics_smoke,
        _run_tracked_references_smoke,
        run_orchestrate_runtime_smoke,
        _run_learning_signal_smoke,
        _run_budget_audit_smoke,
        _run_defensive_audit_smoke,
        _run_learning_candidate_smoke,
        _run_learning_digest_smoke,
        _run_learning_context_smoke,
        _run_learning_user_profile_smoke,
        _run_learning_deferred_review_smoke,
        _run_learning_telemetry_smoke,
        _run_observability_smoke,
        _run_project_profile_smoke,
        run_identity_veil_smoke,
        _run_package_smoke,
        _run_global_project_scope_smoke,
        _run_root_resolver_smoke,
    ]
    if os.environ.get("IMO_VERIFY_SKIP_INSTALL_SMOKE") != "1":
        smoke_checks.append(_run_install_smoke)
    for smoke_check in smoke_checks:
        callback = lambda: _with_observability_events_enabled(smoke_check) if smoke_check is _run_observability_smoke else smoke_check()
        passed = _run_verify_check(
            smoke_check.__name__, callback, trace_id, parent_span_id
        )
        if not passed:
            failures += 1

    if failures:
        print(f"[imo verify] {failures} check(s) failed", file=sys.stderr)
        return 1
    print("[imo verify] all checks passed")
    return 0


def main() -> int:
    trace_id = os.environ.get("IMO_TRACE_ID") or new_trace_id()
    span_id = new_span_id()
    start_ms = now_ms()
    previous_trace = os.environ.get("IMO_TRACE_ID")
    exit_code = 1
    os.environ["IMO_TRACE_ID"] = trace_id

    write_event(
        "verify_start",
        plane="verify",
        component="imo_verify",
        operation="verify",
        phase="start",
        trace_id=trace_id,
        span_id=span_id,
    )

    try:
        with isolated_fixture_runtime():
            exit_code = _execute_suite(trace_id, span_id)
            return exit_code
    finally:
        try:
            write_event(
                "verify_end",
                plane="verify",
                component="imo_verify",
                operation="verify",
                phase="end",
                trace_id=trace_id,
                span_id=span_id,
                outcome="ok" if exit_code == 0 else "error",
                duration_ms=now_ms() - start_ms,
                exit_code=exit_code,
                status="passed" if exit_code == 0 else "failed",
            )
        finally:
            if previous_trace is None:
                os.environ.pop("IMO_TRACE_ID", None)
            else:
                os.environ["IMO_TRACE_ID"] = previous_trace
