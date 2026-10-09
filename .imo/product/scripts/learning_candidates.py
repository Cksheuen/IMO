from __future__ import annotations

import json
import sys
from typing import Any
from uuid import uuid4

from learning_common import (
    CANDIDATES_DISPLAY_PATH,
    CANDIDATES_PATH,
    _load_jsonl,
    _now,
    _record_event,
    _value,
    _write_jsonl,
)
from learning_signals import _load_signals


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


def _load_candidates() -> tuple[list[dict[str, Any]], str | None]:
    if not CANDIDATES_PATH.exists():
        return [], f"no candidates found at {CANDIDATES_DISPLAY_PATH}"
    return _load_jsonl(CANDIDATES_PATH, CANDIDATES_DISPLAY_PATH)


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
