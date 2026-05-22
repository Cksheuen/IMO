#!/usr/bin/env python3
"""IMO learning-plane CLI."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any
from uuid import uuid4

import learning_events


ROOT = Path(__file__).resolve().parents[3]
SIGNALS_PATH = ROOT / ".imo/.runtime/learning/signals.jsonl"
CANDIDATES_PATH = ROOT / ".imo/.runtime/learning/candidates.jsonl"
DIGEST_PATH = ROOT / ".imo/.runtime/learning/digest.json"
SESSION_ACTIVITY_PATH = ROOT / ".imo/.runtime/session/activity.json"
DISPLAY_PATH = ".imo/.runtime/learning/digest.json"
SIGNALS_DISPLAY_PATH = ".imo/.runtime/learning/signals.jsonl"
CANDIDATES_DISPLAY_PATH = ".imo/.runtime/learning/candidates.jsonl"
SESSION_ACTIVITY_DISPLAY_PATH = ".imo/.runtime/session/activity.json"
SCOPES = {"session", "task", "project", "global"}
PRIVACY_CLASSES = {"public", "project_private", "sensitive"}
CONFIDENCE_LEVELS = {"low", "medium", "high"}
CANDIDATE_STATUSES = {"pending", "rejected"}
DIGEST_PRIORITIES = {"normal", "high"}
ACTIVITY_STATES = {"active", "post_turn", "quiescent"}


def _usage() -> str:
    return """Usage:
  scripts/imo.sh learning list
  scripts/imo.sh learning inspect <id>
  scripts/imo.sh learning signal list
  scripts/imo.sh learning signal add --summary <text> [options]
  scripts/imo.sh learning candidate build
  scripts/imo.sh learning candidate list
  scripts/imo.sh learning candidate inspect <id>
  scripts/imo.sh learning candidate reject <id> --reason <text>
  scripts/imo.sh learning digest promote <candidate-id> --review-ref <ref> --rollback-id <id>
  scripts/imo.sh learning digest disable <id> --reason <text>
  scripts/imo.sh learning digest reset --scope project|global
  scripts/imo.sh learning activity status
  scripts/imo.sh learning activity mark --state active|post_turn|quiescent [options]
  scripts/imo.sh learning review prepare [--force]
  scripts/imo.sh learning review inbox
  scripts/imo.sh learning review inspect <candidate-id>
  scripts/imo.sh learning review approve <candidate-id> --review-ref <ref> --rollback-id <id>
  scripts/imo.sh learning review reject <candidate-id> --reason <text>
  scripts/imo.sh learning metrics summary [--json]

List and inspect commands are read-only. Signal commands write raw learning
signals only. Candidate and review prepare commands write candidates only; they
do not mutate active digest state. Digest control and review approve commands
require explicit review metadata.

Signal add options:
  --source-agent <id>  Source agent or skill id. Default: manual
  --scope <scope>      session | task | project | global. Default: project
  --privacy <privacy>  public | project_private | sensitive. Default: project_private
  --confidence <level> low | medium | high. Default: low
  --ttl <duration>     Optional duration string, such as 7d or null
  --evidence-ref <ref> Optional evidence pointer

Activity mark options:
  --session-id <id>         Session id. Default: manual
  --task-id <id>            Optional task id
  --running-tools <count>   Non-negative integer. Default: 0
  --running-agents <count>  Non-negative integer. Default: 0
  --pending-approval <bool> true | false. Default: false
"""


def _load_digest() -> tuple[list[dict[str, Any]], str | None]:
    if not DIGEST_PATH.exists():
        return [], f"no active digest found at {DISPLAY_PATH}"

    try:
        with DIGEST_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid json in {DISPLAY_PATH}: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"failed to read {DISPLAY_PATH}: {exc}") from exc

    if isinstance(data, list):
        raw_items = data
    elif isinstance(data, dict):
        raw_items = data.get("items", data.get("digest_items", []))
    else:
        raise ValueError(f"{DISPLAY_PATH} must be a JSON object or list")

    if not isinstance(raw_items, list):
        raise ValueError(f"{DISPLAY_PATH} items must be a list")

    items: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            raise ValueError(f"{DISPLAY_PATH} item {index} must be an object")
        items.append(item)
    return items, None


def _write_digest(items: list[dict[str, Any]]) -> None:
    DIGEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"items": items}
    DIGEST_PATH.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _load_activity() -> tuple[dict[str, Any] | None, str | None]:
    if not SESSION_ACTIVITY_PATH.exists():
        return None, f"no session activity found at {SESSION_ACTIVITY_DISPLAY_PATH}"

    try:
        with SESSION_ACTIVITY_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid json in {SESSION_ACTIVITY_DISPLAY_PATH}: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"failed to read {SESSION_ACTIVITY_DISPLAY_PATH}: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError(f"{SESSION_ACTIVITY_DISPLAY_PATH} must be a JSON object")
    return data, None


def _write_activity(activity: dict[str, Any]) -> None:
    SESSION_ACTIVITY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SESSION_ACTIVITY_PATH.write_text(
        json.dumps(activity, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _record_event(event_type: str, **fields: Any) -> None:
    learning_events.write_event(event_type, "learning-cli", **fields)


def _value(item: dict[str, Any], key: str, default: str = "-") -> str:
    value = item.get(key)
    if value is None or value == "":
        return default
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=True, sort_keys=True)


def _require_value(args: list[str], index: int, option: str) -> tuple[str | None, int]:
    if index + 1 >= len(args) or args[index + 1].startswith("--"):
        print(f"[imo learning] missing value for {option}", file=sys.stderr)
        return None, index + 1
    return args[index + 1], index + 2


def _parse_bool(value: str) -> bool | None:
    if value == "true":
        return True
    if value == "false":
        return False
    return None


def _parse_nonnegative_int(value: str) -> int | None:
    try:
        parsed = int(value)
    except ValueError:
        return None
    if parsed < 0:
        return None
    return parsed


def _parse_signal_add(args: list[str]) -> tuple[dict[str, str | None], list[str]]:
    values: dict[str, str | None] = {
        "summary": None,
        "source_agent": "manual",
        "scope": "project",
        "privacy": "project_private",
        "confidence": "low",
        "ttl": None,
        "evidence_ref": None,
    }
    errors: list[str] = []
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--summary":
            value, index = _require_value(args, index, option)
            values["summary"] = value
        elif option == "--source-agent":
            value, index = _require_value(args, index, option)
            values["source_agent"] = value
        elif option == "--scope":
            value, index = _require_value(args, index, option)
            values["scope"] = value
        elif option == "--privacy":
            value, index = _require_value(args, index, option)
            values["privacy"] = value
        elif option == "--confidence":
            value, index = _require_value(args, index, option)
            values["confidence"] = value
        elif option == "--ttl":
            value, index = _require_value(args, index, option)
            values["ttl"] = None if value == "null" else value
        elif option == "--evidence-ref":
            value, index = _require_value(args, index, option)
            values["evidence_ref"] = value
        else:
            errors.append(f"unsupported signal add option: {option}")
            index += 1

    return values, errors


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


def _validate_signal_fields(values: dict[str, str | None]) -> list[str]:
    errors: list[str] = []
    summary = values.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        errors.append("--summary is required")

    source_agent = values.get("source_agent")
    if not isinstance(source_agent, str) or not source_agent.strip():
        errors.append("--source-agent must not be empty")

    scope = values.get("scope")
    if scope not in SCOPES:
        errors.append(f"--scope must be one of: {', '.join(sorted(SCOPES))}")

    privacy = values.get("privacy")
    if privacy not in PRIVACY_CLASSES:
        errors.append(f"--privacy must be one of: {', '.join(sorted(PRIVACY_CLASSES))}")

    confidence = values.get("confidence")
    if confidence not in CONFIDENCE_LEVELS:
        errors.append(f"--confidence must be one of: {', '.join(sorted(CONFIDENCE_LEVELS))}")

    return errors


def _load_signals() -> tuple[list[dict[str, Any]], str | None]:
    if not SIGNALS_PATH.exists():
        return [], f"no raw signals found at {SIGNALS_DISPLAY_PATH}"

    items: list[dict[str, Any]] = []
    try:
        with SIGNALS_PATH.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    item = json.loads(stripped)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"invalid json in {SIGNALS_DISPLAY_PATH}:{line_number}: {exc}"
                    ) from exc
                if not isinstance(item, dict):
                    raise ValueError(f"{SIGNALS_DISPLAY_PATH}:{line_number} must be an object")
                items.append(item)
    except OSError as exc:
        raise ValueError(f"failed to read {SIGNALS_DISPLAY_PATH}: {exc}") from exc

    return items, None


def _load_jsonl(path: Path, display_path: str) -> tuple[list[dict[str, Any]], str | None]:
    if not path.exists():
        return [], f"no records found at {display_path}"

    items: list[dict[str, Any]] = []
    try:
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    item = json.loads(stripped)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"invalid json in {display_path}:{line_number}: {exc}") from exc
                if not isinstance(item, dict):
                    raise ValueError(f"{display_path}:{line_number} must be an object")
                items.append(item)
    except OSError as exc:
        raise ValueError(f"failed to read {display_path}: {exc}") from exc

    return items, None


def _write_jsonl(path: Path, display_path: str, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for item in items:
            handle.write(json.dumps(item, ensure_ascii=True, sort_keys=True) + "\n")


def _candidate_key(signal: dict[str, Any]) -> str:
    summary = _value(signal, "summary", "").strip().lower()
    return " ".join(summary.split())


def _status_rank(status: str) -> int:
    if status == "rejected":
        return 0
    return 1


def _confidence_rank(confidence: str) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(confidence, 0)


def _best_confidence(values: list[str]) -> str:
    ranked = sorted(values, key=_confidence_rank, reverse=True)
    return ranked[0] if ranked else "low"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_candidates() -> tuple[list[dict[str, Any]], str | None]:
    if not CANDIDATES_PATH.exists():
        return [], f"no candidates found at {CANDIDATES_DISPLAY_PATH}"
    return _load_jsonl(CANDIDATES_PATH, CANDIDATES_DISPLAY_PATH)


def _list_signals() -> int:
    try:
        items, empty_reason = _load_signals()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'raw signal list is empty'}")
        return 0

    print("id\tcreated_at\tscope\tprivacy\tconfidence\tsource_agent\tsummary")
    for item in items:
        print(
            "\t".join(
                [
                    _value(item, "id"),
                    _value(item, "created_at"),
                    _value(item, "scope"),
                    _value(item, "privacy"),
                    _value(item, "confidence"),
                    _value(item, "source_agent"),
                    _value(item, "summary"),
                ]
            )
        )
    return 0


def _add_signal(args: list[str]) -> int:
    values, parse_errors = _parse_signal_add(args)
    errors = parse_errors + _validate_signal_fields(values)
    if errors:
        for error in errors:
            print(f"[imo learning] {error}", file=sys.stderr)
        return 64

    signal = {
        "id": f"signal-{uuid4().hex}",
        "created_at": _now(),
        "source_agent": str(values["source_agent"]).strip(),
        "scope": values["scope"],
        "privacy": values["privacy"],
        "confidence": values["confidence"],
        "ttl": values["ttl"],
        "summary": str(values["summary"]).strip(),
    }
    if values.get("evidence_ref"):
        signal["evidence_ref"] = str(values["evidence_ref"]).strip()

    try:
        SIGNALS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with SIGNALS_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(signal, ensure_ascii=True, sort_keys=True) + "\n")
    except OSError as exc:
        print(f"[imo learning] failed to write {SIGNALS_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1

    _record_event(
        "signal_created",
        signal_id=signal["id"],
        scope=signal["scope"],
        privacy=signal["privacy"],
        confidence=signal["confidence"],
    )
    print(signal["id"])
    return 0


def _build_candidates(event_type: str = "candidate_build_completed", *, forced: bool | None = None) -> int:
    try:
        signals, empty_reason = _load_signals()
        existing, _ = _load_candidates()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not signals:
        print(f"[imo learning] {empty_reason or 'raw signal list is empty'}")
        return 0

    existing_by_summary = {_candidate_key(candidate): candidate for candidate in existing}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for signal in signals:
        key = _candidate_key(signal)
        if not key:
            continue
        grouped.setdefault(key, []).append(signal)

    created = 0
    updated = 0
    now = _now()
    for key, group in sorted(grouped.items()):
        signal_ids = sorted({_value(signal, "id", "") for signal in group if signal.get("id")})
        if not signal_ids:
            continue
        evidence_refs = sorted(
            {_value(signal, "evidence_ref", "") for signal in group if signal.get("evidence_ref")}
        )
        scopes = [_value(signal, "scope", "project") for signal in group]
        privacy_values = [_value(signal, "privacy", "project_private") for signal in group]
        confidence_values = [_value(signal, "confidence", "low") for signal in group]
        summary = _value(group[0], "summary", key).strip()

        existing_candidate = existing_by_summary.get(key)
        if existing_candidate:
            known_refs = set(existing_candidate.get("source_signal_refs", []))
            merged_refs = sorted(known_refs | set(signal_ids))
            if merged_refs != existing_candidate.get("source_signal_refs", []):
                existing_candidate["source_signal_refs"] = merged_refs
                existing_candidate["updated_at"] = now
                existing_candidate["confidence"] = _best_confidence(
                    [str(existing_candidate.get("confidence", "low"))] + confidence_values
                )
                if evidence_refs:
                    known_evidence = set(existing_candidate.get("evidence_refs", []))
                    existing_candidate["evidence_refs"] = sorted(known_evidence | set(evidence_refs))
                updated += 1
            continue

        candidate = {
            "id": f"candidate-{uuid4().hex}",
            "created_at": now,
            "updated_at": now,
            "status": "pending",
            "scope": "global" if all(scope == "global" for scope in scopes) else "project",
            "privacy": "sensitive" if "sensitive" in privacy_values else (
                "project_private" if "project_private" in privacy_values else "public"
            ),
            "confidence": _best_confidence(confidence_values),
            "summary": summary,
            "source_signal_refs": signal_ids,
        }
        if evidence_refs:
            candidate["evidence_refs"] = evidence_refs
        existing.append(candidate)
        existing_by_summary[key] = candidate
        created += 1

    try:
        _write_jsonl(CANDIDATES_PATH, CANDIDATES_DISPLAY_PATH, existing)
    except OSError as exc:
        print(f"[imo learning] failed to write {CANDIDATES_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1

    event_fields: dict[str, Any] = {
        "created_count": created,
        "updated_count": updated,
    }
    if forced is not None:
        event_fields["forced"] = forced
    _record_event(event_type, **event_fields)
    print(f"[imo learning] candidates built: {created} created, {updated} updated")
    return 0


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


def _promoted_candidate_ids() -> set[str]:
    digest_items, _ = _load_digest()
    promoted: set[str] = set()
    for item in digest_items:
        source_candidates = item.get("source_candidates")
        if isinstance(source_candidates, list):
            promoted.update(str(candidate_id) for candidate_id in source_candidates)
    return promoted


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


def _list_candidates() -> int:
    try:
        items, empty_reason = _load_candidates()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'candidate list is empty'}")
        return 0

    print("id\tstatus\tscope\tprivacy\tconfidence\tsignals\tsummary")
    for item in sorted(items, key=lambda candidate: (_status_rank(str(candidate.get("status", ""))), _value(candidate, "summary"))):
        signal_refs = item.get("source_signal_refs", [])
        signal_count = len(signal_refs) if isinstance(signal_refs, list) else 0
        print(
            "\t".join(
                [
                    _value(item, "id"),
                    _value(item, "status"),
                    _value(item, "scope"),
                    _value(item, "privacy"),
                    _value(item, "confidence"),
                    str(signal_count),
                    _value(item, "summary"),
                ]
            )
        )
    return 0


def _inspect_candidate(candidate_id: str) -> int:
    try:
        items, empty_reason = _load_candidates()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'candidate list is empty'}", file=sys.stderr)
        return 1

    for item in items:
        if item.get("id") == candidate_id:
            print(json.dumps(item, ensure_ascii=True, indent=2, sort_keys=True))
            return 0

    print(f"[imo learning] candidate not found: {candidate_id}", file=sys.stderr)
    return 1


def _reject_candidate(candidate_id: str, args: list[str]) -> int:
    if len(args) != 2 or args[0] != "--reason" or not args[1].strip():
        print("[imo learning] candidate reject requires --reason <text>", file=sys.stderr)
        return 64

    try:
        items, empty_reason = _load_candidates()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'candidate list is empty'}", file=sys.stderr)
        return 1

    for item in items:
        if item.get("id") == candidate_id:
            item["status"] = "rejected"
            item["rejection_reason"] = args[1].strip()
            item["updated_at"] = _now()
            try:
                _write_jsonl(CANDIDATES_PATH, CANDIDATES_DISPLAY_PATH, items)
            except OSError as exc:
                print(f"[imo learning] failed to write {CANDIDATES_DISPLAY_PATH}: {exc}", file=sys.stderr)
                return 1
            _record_event("candidate_rejected", candidate_id=candidate_id)
            print(candidate_id)
            return 0

    print(f"[imo learning] candidate not found: {candidate_id}", file=sys.stderr)
    return 1


def _parse_digest_promote(args: list[str]) -> tuple[dict[str, str], list[str]]:
    values = {
        "review_ref": "",
        "rollback_id": "",
        "priority": "normal",
    }
    errors: list[str] = []
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--review-ref":
            value, index = _require_value(args, index, option)
            values["review_ref"] = value or ""
        elif option == "--rollback-id":
            value, index = _require_value(args, index, option)
            values["rollback_id"] = value or ""
        elif option == "--priority":
            value, index = _require_value(args, index, option)
            values["priority"] = value or ""
        else:
            errors.append(f"unsupported digest promote option: {option}")
            index += 1

    if not values["review_ref"].strip():
        errors.append("--review-ref is required")
    if not values["rollback_id"].strip():
        errors.append("--rollback-id is required")
    if values["priority"] not in DIGEST_PRIORITIES:
        errors.append(f"--priority must be one of: {', '.join(sorted(DIGEST_PRIORITIES))}")
    return values, errors


def _promote_digest(candidate_id: str, args: list[str], event_type: str = "digest_promoted") -> int:
    values, errors = _parse_digest_promote(args)
    if errors:
        for error in errors:
            print(f"[imo learning] {error}", file=sys.stderr)
        return 64

    try:
        candidates, empty_reason = _load_candidates()
        digest_items, _ = _load_digest()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not candidates:
        print(f"[imo learning] {empty_reason or 'candidate list is empty'}", file=sys.stderr)
        return 1

    candidate = next((item for item in candidates if item.get("id") == candidate_id), None)
    if not candidate:
        print(f"[imo learning] candidate not found: {candidate_id}", file=sys.stderr)
        return 1
    if candidate.get("status") != "pending":
        print(f"[imo learning] candidate is not promotable: {candidate_id}", file=sys.stderr)
        return 1

    source_signal_refs = candidate.get("source_signal_refs")
    if not isinstance(source_signal_refs, list) or not source_signal_refs:
        print(f"[imo learning] candidate lacks source_signal_refs: {candidate_id}", file=sys.stderr)
        return 1

    now = _now()
    existing = next(
        (item for item in digest_items if candidate_id in item.get("source_candidates", [])),
        None,
    )
    if existing:
        digest_id = _value(existing, "id")
        existing.update(
            {
                "last_updated": now,
                "status": "active",
                "priority": values["priority"],
                "rollback_id": values["rollback_id"].strip(),
                "review_ref": values["review_ref"].strip(),
                "summary": _value(candidate, "summary"),
            }
        )
    else:
        digest_id = f"digest-{uuid4().hex}"
        digest_items.append(
            {
                "id": digest_id,
                "digest_version": "1",
                "scope": "global" if candidate.get("scope") == "global" else "project",
                "last_updated": now,
                "status": "active",
                "priority": values["priority"],
                "rollback_id": values["rollback_id"].strip(),
                "review_ref": values["review_ref"].strip(),
                "summary": _value(candidate, "summary"),
                "source_candidates": [candidate_id],
                "source_signal_refs": source_signal_refs,
            }
        )

    try:
        _write_digest(digest_items)
    except OSError as exc:
        print(f"[imo learning] failed to write {DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1

    _record_event(
        event_type,
        candidate_id=candidate_id,
        digest_id=digest_id,
        scope="global" if candidate.get("scope") == "global" else "project",
    )
    print(digest_id)
    return 0


def _disable_digest(digest_id: str, args: list[str]) -> int:
    if len(args) != 2 or args[0] != "--reason" or not args[1].strip():
        print("[imo learning] digest disable requires --reason <text>", file=sys.stderr)
        return 64

    try:
        digest_items, empty_reason = _load_digest()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not digest_items:
        print(f"[imo learning] {empty_reason or 'active digest is empty'}", file=sys.stderr)
        return 1

    for item in digest_items:
        if item.get("id") == digest_id:
            item["status"] = "disabled"
            item["disabled_reason"] = args[1].strip()
            item["last_updated"] = _now()
            try:
                _write_digest(digest_items)
            except OSError as exc:
                print(f"[imo learning] failed to write {DISPLAY_PATH}: {exc}", file=sys.stderr)
                return 1
            _record_event("digest_disabled", digest_id=digest_id, scope=_value(item, "scope"))
            print(digest_id)
            return 0

    print(f"[imo learning] digest item not found: {digest_id}", file=sys.stderr)
    return 1


def _reset_digest(args: list[str]) -> int:
    if len(args) != 2 or args[0] != "--scope" or args[1] not in {"project", "global"}:
        print("[imo learning] digest reset requires --scope project|global", file=sys.stderr)
        return 64

    scope = args[1]
    try:
        digest_items, empty_reason = _load_digest()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not digest_items:
        print(f"[imo learning] {empty_reason or 'active digest is empty'}")
        return 0

    remaining = [item for item in digest_items if item.get("scope") != scope]
    removed = len(digest_items) - len(remaining)
    try:
        if remaining:
            _write_digest(remaining)
        elif DIGEST_PATH.exists():
            DIGEST_PATH.unlink()
    except OSError as exc:
        print(f"[imo learning] failed to reset {DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1

    _record_event("digest_reset", scope=scope, removed_count=removed)
    print(f"[imo learning] digest reset: {removed} {scope} item(s) removed")
    return 0


def _list_items() -> int:
    try:
        items, empty_reason = _load_digest()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'active digest is empty'}")
        return 0

    print("id\tstatus\tscope\tpriority\tsummary")
    for item in items:
        print(
            "\t".join(
                [
                    _value(item, "id"),
                    _value(item, "status"),
                    _value(item, "scope"),
                    _value(item, "priority"),
                    _value(item, "summary"),
                ]
            )
        )
    return 0


def _inspect_item(item_id: str) -> int:
    try:
        items, empty_reason = _load_digest()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'active digest is empty'}", file=sys.stderr)
        return 1

    for item in items:
        if item.get("id") == item_id:
            print(json.dumps(item, ensure_ascii=True, indent=2, sort_keys=True))
            return 0

    print(f"[imo learning] digest item not found: {item_id}", file=sys.stderr)
    return 1


def _metrics_summary(args: list[str]) -> int:
    if args not in ([], ["--json"]):
        print("[imo learning] metrics summary supports only optional --json", file=sys.stderr)
        return 64

    as_json = args == ["--json"]
    try:
        events, empty_reason = learning_events.load_events()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"[imo learning] failed to read {learning_events.EVENTS_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1

    summary = learning_events.summarize_events(events)
    if as_json:
        print(json.dumps(summary, ensure_ascii=True, indent=2, sort_keys=True))
        return 0

    if not events:
        print(f"[imo learning] {empty_reason or 'learning event list is empty'}")
    print(f"total_events\t{summary['total_events']}")
    print(f"candidate_created_count\t{summary['candidate_counts']['created']}")
    print(f"candidate_updated_count\t{summary['candidate_counts']['updated']}")
    print(f"review_approved_count\t{summary['review_decisions']['approved']}")
    print(f"review_rejected_count\t{summary['review_decisions']['rejected']}")
    print(f"digest_promoted_count\t{summary['digest_controls']['promoted']}")
    print(f"digest_disabled_count\t{summary['digest_controls']['disabled']}")
    print(f"digest_reset_count\t{summary['digest_controls']['reset']}")
    print(f"context_digest_injected_count\t{summary['context_digest_injected_count']}")
    print(f"active_task_interruption_count\t{summary['safety']['active_task_interruption_count']}")
    print(f"auto_promotion_count\t{summary['safety']['auto_promotion_count']}")
    if summary["prepare_skip_by_reason"]:
        print("prepare_skip_by_reason")
        for reason, count in sorted(summary["prepare_skip_by_reason"].items()):
            print(f"- {reason}\t{count}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print(_usage(), end="")
        return 0

    command = args[0]
    if command == "list" and len(args) == 1:
        return _list_items()
    if command == "inspect" and len(args) == 2:
        return _inspect_item(args[1])
    if command == "signal" and len(args) >= 2:
        signal_command = args[1]
        if signal_command == "list" and len(args) == 2:
            return _list_signals()
        if signal_command == "add":
            return _add_signal(args[2:])
    if command == "candidate" and len(args) >= 2:
        candidate_command = args[1]
        if candidate_command == "build" and len(args) == 2:
            return _build_candidates()
        if candidate_command == "list" and len(args) == 2:
            return _list_candidates()
        if candidate_command == "inspect" and len(args) == 3:
            return _inspect_candidate(args[2])
        if candidate_command == "reject" and len(args) >= 3:
            return _reject_candidate(args[2], args[3:])
    if command == "activity" and len(args) >= 2:
        activity_command = args[1]
        if activity_command == "status" and len(args) == 2:
            return _activity_status()
        if activity_command == "mark":
            return _mark_activity(args[2:])
    if command == "review" and len(args) >= 2:
        review_command = args[1]
        if review_command == "prepare":
            return _review_prepare(args[2:])
        if review_command in {"inbox", "list"} and len(args) == 2:
            return _review_inbox()
        if review_command == "inspect" and len(args) == 3:
            return _inspect_candidate(args[2])
        if review_command == "approve" and len(args) >= 3:
            return _promote_digest(args[2], args[3:], "candidate_approved")
        if review_command == "reject" and len(args) >= 3:
            return _reject_candidate(args[2], args[3:])
    if command == "metrics" and len(args) >= 2:
        metrics_command = args[1]
        if metrics_command == "summary":
            return _metrics_summary(args[2:])
    if command == "digest" and len(args) >= 2:
        digest_command = args[1]
        if digest_command == "promote" and len(args) >= 3:
            return _promote_digest(args[2], args[3:])
        if digest_command == "disable" and len(args) >= 3:
            return _disable_digest(args[2], args[3:])
        if digest_command == "reset":
            return _reset_digest(args[2:])

    print(_usage(), end="", file=sys.stderr)
    print(f"\nUnsupported learning command: {' '.join(args)}", file=sys.stderr)
    return 64


if __name__ == "__main__":
    raise SystemExit(main())
