from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from uuid import uuid4

from learning_common import (
    DIGEST_PATH,
    DIGEST_PRIORITIES,
    DISPLAY_PATH,
    GLOBAL_DIGEST_PATH,
    GLOBAL_DISPLAY_PATH,
    _now,
    _record_event,
    _require_value,
    _value,
)
from learning_candidates import _load_candidates
import learning_events


def _load_digest() -> tuple[list[dict[str, Any]], str | None]:
    return _load_digest_from(DIGEST_PATH, DISPLAY_PATH)


def _load_digest_from(path: Path, display_path: str) -> tuple[list[dict[str, Any]], str | None]:
    if not path.exists():
        return [], f"no active digest found at {display_path}"
    try:
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid json in {display_path}: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"failed to read {display_path}: {exc}") from exc

    if isinstance(data, list):
        raw_items = data
    elif isinstance(data, dict):
        raw_items = data.get("items", data.get("digest_items", []))
    else:
        raise ValueError(f"{display_path} must be a JSON object or list")

    if not isinstance(raw_items, list):
        raise ValueError(f"{display_path} items must be a list")

    items: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            raise ValueError(f"{display_path} item {index} must be an object")
        items.append(item)
    return items, None


def _write_digest(items: list[dict[str, Any]]) -> None:
    _write_digest_to(DIGEST_PATH, items)


def _write_digest_to(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"items": items}
    path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _promoted_candidate_ids() -> set[str]:
    digest_items, _ = _load_digest()
    promoted: set[str] = set()
    for item in digest_items:
        source_candidates = item.get("source_candidates")
        if isinstance(source_candidates, list):
            promoted.update(str(candidate_id) for candidate_id in source_candidates)
    return promoted


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
    target_scope = "global" if candidate.get("scope") == "global" else "project"
    if target_scope == "global" and candidate.get("privacy") != "public":
        print("[imo learning] global digest promotion requires public candidate privacy", file=sys.stderr)
        return 1

    source_signal_refs = candidate.get("source_signal_refs")
    if not isinstance(source_signal_refs, list) or not source_signal_refs:
        print(f"[imo learning] candidate lacks source_signal_refs: {candidate_id}", file=sys.stderr)
        return 1

    digest_path = GLOBAL_DIGEST_PATH if target_scope == "global" else DIGEST_PATH
    digest_display = GLOBAL_DISPLAY_PATH if target_scope == "global" else DISPLAY_PATH
    try:
        digest_items, _ = _load_digest_from(digest_path, digest_display)
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
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
                "scope": target_scope,
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
        _write_digest_to(digest_path, digest_items)
    except OSError as exc:
        print(f"[imo learning] failed to write {digest_display}: {exc}", file=sys.stderr)
        return 1

    _record_event(
        event_type,
        candidate_id=candidate_id,
        digest_id=digest_id,
        scope=target_scope,
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
    digest_path = GLOBAL_DIGEST_PATH if scope == "global" else DIGEST_PATH
    digest_display = GLOBAL_DISPLAY_PATH if scope == "global" else DISPLAY_PATH
    try:
        digest_items, empty_reason = _load_digest_from(digest_path, digest_display)
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
            _write_digest_to(digest_path, remaining)
        elif digest_path.exists():
            digest_path.unlink()
    except OSError as exc:
        print(f"[imo learning] failed to reset {digest_display}: {exc}", file=sys.stderr)
        return 1

    _record_event("digest_reset", scope=scope, removed_count=removed)
    print(f"[imo learning] digest reset: {removed} {scope} item(s) removed")
    return 0


def _load_digest_for_scope(scope: str) -> tuple[list[dict[str, Any]], str | None]:
    if scope == "project":
        return _load_digest_from(DIGEST_PATH, DISPLAY_PATH)
    if scope == "global":
        return _load_digest_from(GLOBAL_DIGEST_PATH, GLOBAL_DISPLAY_PATH)

    project_items, project_empty = _load_digest_from(DIGEST_PATH, DISPLAY_PATH)
    global_items, global_empty = _load_digest_from(GLOBAL_DIGEST_PATH, GLOBAL_DISPLAY_PATH)
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source, items in (("project", project_items), ("global", global_items)):
        for item in items:
            item_id = item.get("id")
            key = item_id if isinstance(item_id, str) else json.dumps(item, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            copy = dict(item)
            copy["_source"] = source
            merged.append(copy)
    if not merged:
        return [], project_empty or global_empty or "active digest is empty"
    return merged, None


def _parse_list_scope(args: list[str]) -> str | None:
    if not args:
        return "project"
    if len(args) == 2 and args[0] == "--scope" and args[1] in {"project", "global", "merged"}:
        return args[1]
    return None


def _list_items(args: list[str] | None = None) -> int:
    scope = _parse_list_scope(args or [])
    if scope is None:
        print("[imo learning] list supports optional --scope project|global|merged", file=sys.stderr)
        return 64
    try:
        items, empty_reason = _load_digest_for_scope(scope)
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1

    if not items:
        print(f"[imo learning] {empty_reason or 'active digest is empty'}")
        return 0

    print("id\tstatus\tscope\tpriority\tsource\tsummary")
    for item in items:
        print(
            "\t".join(
                [
                    _value(item, "id"),
                    _value(item, "status"),
                    _value(item, "scope"),
                    _value(item, "priority"),
                    _value(item, "_source", scope),
                    _value(item, "summary"),
                ]
            )
        )
    return 0


def _inspect_item(item_id: str) -> int:
    try:
        project_items, project_empty = _load_digest_from(DIGEST_PATH, DISPLAY_PATH)
        global_items, global_empty = _load_digest_from(GLOBAL_DIGEST_PATH, GLOBAL_DISPLAY_PATH)
        items = project_items + global_items
        empty_reason = project_empty or global_empty
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
