from __future__ import annotations

import json
import sys
from typing import Any

from learning_common import (
    ACTIVITY_STATES,
    SESSION_ACTIVITY_DISPLAY_PATH,
    _load_activity,
    _now,
    _parse_bool,
    _parse_nonnegative_int,
    _record_event,
    _require_value,
    _value,
    _write_activity,
)
from learning_candidates import _load_candidates, _build_candidates
from learning_digest import _promoted_candidate_ids


def _parse_activity_mark(args: list[str]) -> tuple[dict[str, str | None], list[str]]:
    values: dict[str, str | None] = {
        "state": None,
        "session_id": "manual",
        "task_id": None,
        "running_tools": "0",
        "running_agents": "0",
        "pending_approval": "false",
    }
    errors: list[str] = []
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--state":
            value, index = _require_value(args, index, option)
            values["state"] = value
        elif option == "--session-id":
            value, index = _require_value(args, index, option)
            values["session_id"] = value
        elif option == "--task-id":
            value, index = _require_value(args, index, option)
            values["task_id"] = value
        elif option == "--running-tools":
            value, index = _require_value(args, index, option)
            values["running_tools"] = value
        elif option == "--running-agents":
            value, index = _require_value(args, index, option)
            values["running_agents"] = value
        elif option == "--pending-approval":
            value, index = _require_value(args, index, option)
            values["pending_approval"] = value
        else:
            errors.append(f"unsupported activity mark option: {option}")
            index += 1
    return values, errors


def _validate_activity_fields(values: dict[str, str | None]) -> list[str]:
    errors: list[str] = []
    if values.get("state") not in ACTIVITY_STATES:
        errors.append(f"--state must be one of: {', '.join(sorted(ACTIVITY_STATES))}")
    session_id = values.get("session_id")
    if not isinstance(session_id, str) or not session_id.strip():
        errors.append("--session-id must not be empty")
    for key, option in (
        ("running_tools", "--running-tools"),
        ("running_agents", "--running-agents"),
    ):
        value = values.get(key)
        if not isinstance(value, str) or _parse_nonnegative_int(value) is None:
            errors.append(f"{option} must be a non-negative integer")
    pending_approval = values.get("pending_approval")
    if not isinstance(pending_approval, str) or _parse_bool(pending_approval) is None:
        errors.append("--pending-approval must be true or false")
    return errors


def _activity_status() -> int:
    try:
        activity, empty_reason = _load_activity()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if activity is None:
        print(f"[imo learning] {empty_reason}")
        return 0

    print(json.dumps(activity, ensure_ascii=True, indent=2, sort_keys=True))
    return 0


def _mark_activity(args: list[str]) -> int:
    values, parse_errors = _parse_activity_mark(args)
    errors = parse_errors + _validate_activity_fields(values)
    if errors:
        for error in errors:
            print(f"[imo learning] {error}", file=sys.stderr)
        return 64

    activity = {
        "schema_version": 1,
        "updated_at": _now(),
        "session_id": str(values["session_id"]).strip(),
        "state": values["state"],
        "running_tools": _parse_nonnegative_int(str(values["running_tools"])),
        "running_agents": _parse_nonnegative_int(str(values["running_agents"])),
        "pending_approval": _parse_bool(str(values["pending_approval"])),
    }
    if values.get("task_id"):
        activity["task_id"] = str(values["task_id"]).strip()

    try:
        _write_activity(activity)
    except OSError as exc:
        print(f"[imo learning] failed to write {SESSION_ACTIVITY_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1

    _record_event("activity_marked", state=activity["state"])
    print(_value(activity, "state"))
    return 0


def _activity_allows_prepare(activity: dict[str, Any] | None) -> tuple[bool, str]:
    if activity is None:
        return False, f"missing activity state at {SESSION_ACTIVITY_DISPLAY_PATH}"
    state = activity.get("state")
    if state not in {"post_turn", "quiescent"}:
        return False, f"activity state is {state or 'unknown'}"
    for key in ("running_tools", "running_agents"):
        value = activity.get(key, 0)
        if not isinstance(value, int) or value != 0:
            return False, f"{key} is {value}"
    if activity.get("pending_approval") is not False:
        return False, "pending approval is true"
    return True, "safe for candidate preparation"


def _review_prepare(args: list[str]) -> int:
    force = False
    for option in args:
        if option == "--force":
            force = True
        else:
            print(f"[imo learning] unsupported review prepare option: {option}", file=sys.stderr)
            return 64

    if not force:
        try:
            activity, _ = _load_activity()
        except ValueError as exc:
            print(f"[imo learning] {exc}", file=sys.stderr)
            return 1
        allowed, reason = _activity_allows_prepare(activity)
        if not allowed:
            _record_event("prepare_skipped", reason=reason, forced=False)
            print(f"[imo learning] review prepare skipped: {reason}")
            return 0

    return _build_candidates("prepare_completed", forced=force)


def _review_inbox() -> int:
    try:
        candidates, empty_reason = _load_candidates()
        promoted = _promoted_candidate_ids()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not candidates:
        _record_event("inbox_viewed", pending_count=0)
        print(f"[imo learning] {empty_reason or 'candidate list is empty'}")
        return 0

    pending = [
        candidate
        for candidate in candidates
        if candidate.get("status") == "pending" and candidate.get("id") not in promoted
    ]
    _record_event("inbox_viewed", pending_count=len(pending))
    if not pending:
        print("[imo learning] review inbox is empty")
        return 0

    print("id\tscope\tprivacy\tconfidence\tsignals\tsummary")
    for item in sorted(pending, key=lambda candidate: _value(candidate, "summary")):
        signal_refs = item.get("source_signal_refs", [])
        signal_count = len(signal_refs) if isinstance(signal_refs, list) else 0
        print(
            "\t".join(
                [
                    _value(item, "id"),
                    _value(item, "scope"),
                    _value(item, "privacy"),
                    _value(item, "confidence"),
                    str(signal_count),
                    _value(item, "summary"),
                ]
            )
        )
    return 0
