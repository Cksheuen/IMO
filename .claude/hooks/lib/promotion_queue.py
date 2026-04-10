#!/usr/bin/env python3
"""Shared helpers for the promotion queue lifecycle."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional


QUEUE_VERSION = 2
QUEUE_PATH = Path("promotion-queue.json")
ACTIONABLE_STATUSES = {"pending", "processing", "failed"}
STATUS_PRIORITY = {"pending": 0, "failed": 1, "processing": 2, "completed": 3}


def now_iso() -> str:
    return datetime.now().isoformat()


def find_repo_root(start_path: str) -> Optional[Path]:
    current = Path(start_path).resolve()
    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent
    return None


def queue_file_candidates(repo_root: Path) -> list[Path]:
    return [repo_root / QUEUE_PATH]


def default_dispatch_state() -> dict:
    return {
        "status": "idle",
        "consumer": "promote-notes",
        "attempts": 0,
        "requestedAt": None,
        "lastAttemptAt": None,
        "finishedAt": None,
        "lastError": None,
        "background_spawned": False,
        "background_pid": None,
        "background_log": None,
        "background_exit_code": None,
        "spawned_at": None,
    }


def default_queue() -> dict:
    return {
        "version": QUEUE_VERSION,
        "updatedAt": now_iso(),
        "dispatch": default_dispatch_state(),
        "candidates": [],
    }


def normalize_candidate(item: dict, queue_updated_at: Optional[str] = None) -> Optional[dict]:
    path = item.get("path")
    if not path:
        return None

    timestamp = item.get("enqueuedAt") or queue_updated_at or now_iso()
    last_seen = item.get("lastSeenAt") or item.get("updatedAt") or timestamp

    normalized = {
        "id": item.get("id") or path,
        "path": path,
        "signal": item.get("signal") or "unknown",
        "status": item.get("status") or "pending",
        "source": item.get("source") or "promotion-scan",
        "enqueuedAt": timestamp,
        "lastSeenAt": last_seen,
        "attempts": item.get("attempts", 0),
    }

    if item.get("result") is not None:
        normalized["result"] = item["result"]
    if item.get("lastError"):
        normalized["lastError"] = item["lastError"]

    return normalized


def normalize_queue(queue: Optional[dict]) -> dict:
    if not isinstance(queue, dict):
        return default_queue()

    updated_at = queue.get("updatedAt") or now_iso()
    dispatch = default_dispatch_state()
    dispatch.update(queue.get("dispatch") or {})

    normalized = {
        "version": queue.get("version") or QUEUE_VERSION,
        "updatedAt": updated_at,
        "dispatch": dispatch,
        "candidates": [],
    }

    candidates_by_id: dict[str, dict[str, Any]] = {}

    def upsert(item: dict, forced_status: Optional[str] = None) -> None:
        candidate = normalize_candidate(item, updated_at)
        if not candidate:
            return
        if forced_status:
            candidate["status"] = forced_status

        key = str(candidate["id"])
        existing = candidates_by_id.get(key)
        if existing is None:
            candidates_by_id[key] = candidate
            return

        existing_status = str(existing.get("status", "pending"))
        new_status = str(candidate.get("status", "pending"))
        if STATUS_PRIORITY.get(new_status, 0) >= STATUS_PRIORITY.get(existing_status, 0):
            merged = dict(existing)
            merged.update(candidate)
        else:
            merged = dict(candidate)
            merged.update(existing)
        candidates_by_id[key] = merged

    for item in queue.get("candidates", []):
        upsert(item)
    for item in queue.get("processing", []):
        upsert(item, "processing")
    for item in queue.get("completed", []):
        upsert(item, "completed")

    normalized["candidates"] = list(candidates_by_id.values())

    return normalized


def load_queue(repo_root: Path) -> tuple[dict, Path]:
    for queue_path in queue_file_candidates(repo_root):
        try:
            payload = json.loads(queue_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            continue
        return normalize_queue(payload), queue_path

    return default_queue(), repo_root / QUEUE_PATH


def actionable_candidates(queue: dict) -> list[dict]:
    return [
        item for item in queue.get("candidates", []) if item.get("status") in ACTIONABLE_STATUSES
    ]


def pending_candidates(queue: dict) -> list[dict]:
    return [item for item in queue.get("candidates", []) if item.get("status") == "pending"]


def compact_queue(queue: dict) -> dict:
    normalized = normalize_queue(queue)
    normalized["candidates"] = [
        item for item in normalized.get("candidates", []) if item.get("status") != "completed"
    ]
    return normalized


def candidate_summary(candidates: Iterable[dict], max_items: int = 5) -> str:
    lines = []
    for item in list(candidates)[:max_items]:
        lines.append(
            f"- {item.get('path', 'unknown')} ({item.get('signal', 'unknown')}, status={item.get('status', 'unknown')})"
        )
    return "\n".join(lines)


def merge_scan_candidates(queue: dict, candidates: list[dict], source: str = "promotion-scan") -> tuple[dict, list[dict]]:
    normalized_queue = normalize_queue(queue)
    existing = {item["path"]: item for item in normalized_queue["candidates"]}
    merged = []

    for item in candidates:
        path = item.get("path")
        signal = item.get("signal") or "unknown"
        if not path:
            continue

        current = existing.get(path)
        if current:
            current["signal"] = signal
            current["source"] = source
            current["lastSeenAt"] = now_iso()
            if current.get("status") != "processing":
                current["status"] = "pending"
            merged.append(current)
            continue

        candidate = normalize_candidate(
            {
                "path": path,
                "signal": signal,
                "status": "pending",
                "source": source,
                "enqueuedAt": now_iso(),
                "lastSeenAt": now_iso(),
            }
        )
        if candidate:
            normalized_queue["candidates"].append(candidate)
            existing[path] = candidate
            merged.append(candidate)

    normalized_queue["updatedAt"] = now_iso()
    return normalized_queue, merged


def prepare_dispatch(queue: dict, limit: int = 5) -> tuple[dict, list[dict]]:
    normalized_queue = normalize_queue(queue)
    candidates = normalized_queue.get("candidates", [])

    selected = [item for item in candidates if item.get("status") == "processing"]
    if not selected:
        selected = [item for item in candidates if item.get("status") in {"pending", "failed"}][:limit]
        for item in selected:
            item["status"] = "processing"
            item["attempts"] = item.get("attempts", 0) + 1
            item.pop("lastError", None)

    if selected:
        normalized_queue["dispatch"]["status"] = "running"
        normalized_queue["dispatch"]["requestedAt"] = normalized_queue["dispatch"].get("requestedAt") or now_iso()
        normalized_queue["dispatch"]["lastAttemptAt"] = now_iso()
        normalized_queue["dispatch"]["attempts"] = normalized_queue["dispatch"].get("attempts", 0) + 1
        normalized_queue["dispatch"]["lastError"] = None
        normalized_queue["updatedAt"] = now_iso()

    return normalized_queue, selected


def requeue_processing(queue: dict, error: Optional[str] = None) -> dict:
    normalized_queue = normalize_queue(queue)
    for item in normalized_queue.get("candidates", []):
        if item.get("status") != "processing":
            continue
        item["status"] = "failed" if error else "pending"
        if error:
            item["lastError"] = error

    dispatch = normalized_queue["dispatch"]
    dispatch["status"] = "failed" if error else "idle"
    dispatch["finishedAt"] = now_iso()
    dispatch["lastAttemptAt"] = now_iso()
    dispatch["lastError"] = error
    normalized_queue["updatedAt"] = now_iso()
    return normalized_queue


def update_background_dispatch(
    queue: dict,
    *,
    status: str,
    spawned: bool,
    log_file: Optional[str] = None,
    pid: Optional[int] = None,
    error: Optional[str] = None,
    exit_code: Optional[int] = None,
) -> dict:
    """Record a background dispatch attempt with success/failure semantics."""

    normalized_queue = normalize_queue(queue)
    dispatch = normalized_queue["dispatch"]
    now = now_iso()

    dispatch["status"] = status
    dispatch["requestedAt"] = now
    dispatch["lastAttemptAt"] = now
    dispatch["attempts"] = dispatch.get("attempts", 0) + 1
    dispatch["lastError"] = error
    dispatch["background_spawned"] = bool(spawned)

    if status in {"failed", "idle", "completed"}:
        dispatch["finishedAt"] = now
    else:
        dispatch["finishedAt"] = None

    if log_file is not None:
        dispatch["background_log"] = log_file

    if spawned:
        dispatch["background_pid"] = pid
        dispatch["background_exit_code"] = None
        dispatch["spawned_at"] = datetime.utcnow().isoformat() + "Z"
    else:
        dispatch["background_pid"] = None
        dispatch["spawned_at"] = None
        if exit_code is not None:
            dispatch["background_exit_code"] = exit_code

    normalized_queue["updatedAt"] = now
    return normalized_queue


def _normalize_result_payload(result: dict) -> dict:
    if "promotionDispatchResult" in result:
        payload = result["promotionDispatchResult"] or {}
        normalized_results = []

        for item in payload.get("processed", []):
            normalized_results.append(
                {
                    "id": item.get("id"),
                    "path": item.get("path"),
                    "status": "completed",
                    "action": item.get("outcome", "promoted"),
                    "summary": item.get("reason") or item.get("outcome"),
                    "target": item.get("target"),
                    "targetPath": item.get("targetPath"),
                    "noteStatus": item.get("noteStatus"),
                    "removeFromQueue": True,
                }
            )

        for item in payload.get("deferred", []):
            normalized_results.append(
                {
                    "id": item.get("id"),
                    "path": item.get("path"),
                    "status": "deferred",
                    "action": item.get("outcome", "deferred"),
                    "summary": item.get("reason"),
                    "target": item.get("target"),
                    "targetPath": item.get("targetPath"),
                    "noteStatus": item.get("noteStatus"),
                    "removeFromQueue": False,
                }
            )

        for item in payload.get("failed", []):
            normalized_results.append(
                {
                    "id": item.get("id"),
                    "path": item.get("path"),
                    "status": "failed",
                    "action": item.get("outcome", "failed"),
                    "summary": item.get("reason"),
                    "target": item.get("target"),
                    "targetPath": item.get("targetPath"),
                    "noteStatus": item.get("noteStatus"),
                    "error": item.get("reason"),
                    "removeFromQueue": False,
                }
            )

        return {
            "status": payload.get("status") or "completed",
            "error": payload.get("error"),
            "results": normalized_results,
        }

    return result


def apply_dispatch_result(queue: dict, result: dict) -> dict:
    normalized_queue = normalize_queue(queue)
    result = _normalize_result_payload(result)
    results = result.get("results", [])
    results_by_key = {}
    for item in results:
        key = item.get("id") or item.get("path")
        if key:
            results_by_key[key] = item

    retained = []
    for candidate in normalized_queue.get("candidates", []):
        result_item = results_by_key.get(candidate.get("id")) or results_by_key.get(candidate.get("path"))
        if not result_item:
            retained.append(candidate)
            continue

        if result_item.get("removeFromQueue", False):
            continue

        candidate["status"] = result_item.get("status") or "failed"
        candidate["result"] = {
            "action": result_item.get("action"),
            "summary": result_item.get("summary"),
            "target": result_item.get("target"),
            "noteStatus": result_item.get("noteStatus"),
        }
        if result_item.get("error"):
            candidate["lastError"] = result_item["error"]
        candidate["lastSeenAt"] = now_iso()
        retained.append(candidate)

    normalized_queue["candidates"] = retained
    normalized_queue["updatedAt"] = now_iso()

    dispatch = normalized_queue["dispatch"]
    dispatch_status = result.get("status") or ("idle" if not retained else "failed")
    if dispatch_status == "completed" and not actionable_candidates(normalized_queue):
        dispatch["status"] = "idle"
    else:
        dispatch["status"] = dispatch_status
    dispatch["finishedAt"] = now_iso()
    dispatch["lastAttemptAt"] = now_iso()
    dispatch["lastError"] = result.get("error")

    return normalized_queue


def save_queue(repo_root: Path, queue: dict) -> Path:
    normalized_queue = compact_queue(queue)
    queue_path = repo_root / QUEUE_PATH

    if actionable_candidates(normalized_queue):
        queue_path.write_text(json.dumps(normalized_queue, ensure_ascii=False, indent=2), encoding="utf-8")
        return queue_path

    try:
        queue_path.unlink()
    except FileNotFoundError:
        pass
    return queue_path


def clear_queue(repo_root: Path) -> None:
    for queue_path in queue_file_candidates(repo_root):
        try:
            queue_path.unlink()
        except FileNotFoundError:
            continue


def queue_is_stale(queue: dict, max_age_hours: int = 6) -> bool:
    updated_at = queue.get("updatedAt")
    if not updated_at:
        return False
    try:
        ts = datetime.fromisoformat(updated_at)
    except ValueError:
        return False
    return datetime.now() - ts > timedelta(hours=max_age_hours)
