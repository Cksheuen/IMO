#!/usr/bin/env python3
"""Read-side helper for declarative memory consumption."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_BUDGET_CHARS = 220
MIN_BUDGET_CHARS = 120
MAX_BUDGET_CHARS = 600
DEFAULT_MAX_ITEMS = 4
MAX_ITEMS = 8
INDEX_NAME = "index.json"
FAIL_CLOSED_AUDIT_LOG_NAME = "runtime-fail-closed-audit.jsonl"


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def _parse_date(value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        return datetime.min
    try:
        return datetime.fromisoformat(value.strip())
    except ValueError:
        return datetime.min


def _short_json_value(value: Any, limit: int = 72) -> str:
    rendered = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(rendered) <= limit:
        return rendered
    return rendered[: max(0, limit - 1)].rstrip() + "…"


def _load_registry(base_dir: Path) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, Path]]:
    index_path = base_dir / INDEX_NAME
    try:
        index_payload = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, {}

    files = index_payload.get("files", [])
    records = index_payload.get("records", [])
    if not isinstance(files, list):
        return {}, {}

    registry_by_subject_key: dict[tuple[str, str], dict[str, Any]] = {}
    if isinstance(records, list):
        for item in records:
            if not isinstance(item, dict):
                continue
            subject = str(item.get("subject", "")).strip()
            key = str(item.get("key", "")).strip()
            if not subject or not key:
                continue
            registry_by_subject_key[(subject, key)] = item

    file_map: dict[str, Path] = {}
    for item in files:
        if not isinstance(item, dict):
            continue
        rel_path = item.get("path")
        if not isinstance(rel_path, str) or not rel_path:
            continue
        candidate_name = Path(rel_path).name
        candidate = base_dir / candidate_name
        if candidate.is_file():
            file_map[candidate_name] = candidate
    return registry_by_subject_key, file_map


def _emit_fail_closed_audit(
    base_dir: Path,
    *,
    reason: str,
    subject: str,
    key: str,
    leaf_file: str,
) -> None:
    """Best-effort audit logging for fail-closed runtime skips."""
    try:
        audit_path = base_dir / FAIL_CLOSED_AUDIT_LOG_NAME
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "subjectKey": f"{subject}.{key}",
            "subject": subject,
            "key": key,
            "leafFile": leaf_file,
        }
        with audit_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
    except OSError:
        # Audit is non-blocking: never affect snapshot fail-closed semantics.
        return


def _extract_records(doc: Any) -> list[dict[str, Any]]:
    if isinstance(doc, dict):
        records = doc.get("records")
        if isinstance(records, list):
            return [item for item in records if isinstance(item, dict)]
        # Single-record compatibility, just in case.
        if {"subject", "key", "status"}.issubset(doc.keys()):
            return [doc]
    return []


def _is_active_fact(record: dict[str, Any]) -> bool:
    if str(record.get("status", "")).strip().lower() != "active":
        return False
    if str(record.get("scope", "")).strip().lower() != "cross-session":
        return False
    if "value" not in record:
        return False
    subject = str(record.get("subject", "")).strip()
    key = str(record.get("key", "")).strip()
    return bool(subject and key)


def _registry_inconsistency_reason(
    registry_record: dict[str, Any] | None,
    leaf_record: dict[str, Any],
    leaf_name: str,
) -> str | None:
    if registry_record is None:
        return "registry_missing_subject_key"

    if str(registry_record.get("file", "")).strip():
        if Path(str(registry_record.get("file"))).name != leaf_name:
            return "registry_file_mismatch"

    if str(registry_record.get("status", "")).strip().lower() != "active":
        return "registry_inactive"

    for field in ("kind", "subject", "key"):
        reg_val = str(registry_record.get(field, "")).strip()
        leaf_val = str(leaf_record.get(field, "")).strip()
        if reg_val and leaf_val and reg_val != leaf_val:
            return f"registry_{field}_mismatch"

    reg_id = str(registry_record.get("id", "")).strip()
    leaf_id = str(leaf_record.get("id", "")).strip()
    if reg_id and leaf_id and reg_id != leaf_id:
        return "registry_id_mismatch"

    return None


def load_active_deduped_records(base_dir: Path | None = None) -> list[dict[str, Any]]:
    root = (base_dir or Path(__file__).resolve().parent).resolve()
    registry_by_subject_key, file_map = _load_registry(root)
    best_by_subject_key: dict[tuple[str, str], tuple[datetime, datetime, dict[str, Any]]] = {}
    conflicts: set[tuple[str, str]] = set()

    for leaf_name, path in file_map.items():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        for record in _extract_records(payload):
            if not _is_active_fact(record):
                continue
            subject = str(record.get("subject", "")).strip()
            key = str(record.get("key", "")).strip()
            dedupe_key = (subject, key)
            if dedupe_key in conflicts:
                continue

            registry_record = registry_by_subject_key.get(dedupe_key)
            inconsistency_reason = _registry_inconsistency_reason(registry_record, record, leaf_name)
            if inconsistency_reason is not None:
                conflicts.add(dedupe_key)
                best_by_subject_key.pop(dedupe_key, None)
                _emit_fail_closed_audit(
                    root,
                    reason=inconsistency_reason,
                    subject=subject,
                    key=key,
                    leaf_file=leaf_name,
                )
                continue

            updated_at = _parse_date(record.get("updatedAt"))
            verified_at = _parse_date(record.get("lastVerifiedAt"))

            existing = best_by_subject_key.get(dedupe_key)
            if existing is None:
                best_by_subject_key[dedupe_key] = (updated_at, verified_at, record)
                continue

            existing_record = existing[2]
            if existing_record != record:
                conflicts.add(dedupe_key)
                best_by_subject_key.pop(dedupe_key, None)
                _emit_fail_closed_audit(
                    root,
                    reason="duplicate_subject_key_conflict",
                    subject=subject,
                    key=key,
                    leaf_file=leaf_name,
                )
                continue

            if (updated_at, verified_at) >= (existing[0], existing[1]):
                best_by_subject_key[dedupe_key] = (updated_at, verified_at, record)

    out = [item[2] for item in best_by_subject_key.values()]
    out.sort(
        key=lambda rec: (
            str(rec.get("subject", "")),
            str(rec.get("key", "")),
        )
    )
    return out


def build_snapshot(
    base_dir: Path | None = None,
    budget_chars: int = DEFAULT_BUDGET_CHARS,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> str:
    budget = _clamp(int(budget_chars), MIN_BUDGET_CHARS, MAX_BUDGET_CHARS)
    item_limit = _clamp(int(max_items), 1, MAX_ITEMS)

    header = (
        "<memory-context>\n"
        "[System note: The following is recalled declarative memory, NOT new user input. "
        "Treat it as stable background facts.]\n"
    )
    footer = "\n</memory-context>"

    records = load_active_deduped_records(base_dir=base_dir)
    if not records:
        return ""

    lines: list[str] = []
    room = budget - len(header) - len(footer)
    if room < 16:
        return ""

    for rec in records[:item_limit]:
        subject = str(rec.get("subject", "")).strip()
        key = str(rec.get("key", "")).strip()
        line = f"- {subject}.{key} = {_short_json_value(rec.get('value'))}"
        projected = len("\n".join(lines + [line]))
        if projected > room:
            break
        lines.append(line)

    if not lines:
        return ""

    snapshot = header + "\n".join(lines) + footer
    if len(snapshot) <= budget:
        return snapshot
    # Final hard budget guard.
    trimmed = snapshot[: max(0, budget - len(footer) - 1)].rstrip() + "…"
    return trimmed + footer
