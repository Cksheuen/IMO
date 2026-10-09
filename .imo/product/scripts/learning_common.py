from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any

import learning_events
import root_resolver

ROOT = Path(__file__).resolve().parents[3]
PROJECT_ROOT = root_resolver.project_root_or_source()
GLOBAL_ROOT = root_resolver.resolve_global_root()
PROJECT_RUNTIME_ROOT = root_resolver.project_runtime_root(PROJECT_ROOT)
SIGNALS_PATH = PROJECT_RUNTIME_ROOT / "learning/signals.jsonl"
CANDIDATES_PATH = PROJECT_RUNTIME_ROOT / "learning/candidates.jsonl"
DIGEST_PATH = PROJECT_RUNTIME_ROOT / "learning/digest.json"
GLOBAL_DIGEST_PATH = root_resolver.global_runtime_root(GLOBAL_ROOT) / "learning/digest.json"
USER_PROFILE_PATH = root_resolver.global_runtime_root(GLOBAL_ROOT) / "learning/user-profile.json"
SESSION_ACTIVITY_PATH = PROJECT_RUNTIME_ROOT / "session/activity.json"
DISPLAY_PATH = root_resolver.project_runtime_display(PROJECT_ROOT, "learning/digest.json")
GLOBAL_DISPLAY_PATH = "~/.imo/runtime/learning/digest.json"
USER_PROFILE_DISPLAY_PATH = "~/.imo/runtime/learning/user-profile.json"
SIGNALS_DISPLAY_PATH = root_resolver.project_runtime_display(PROJECT_ROOT, "learning/signals.jsonl")
CANDIDATES_DISPLAY_PATH = root_resolver.project_runtime_display(PROJECT_ROOT, "learning/candidates.jsonl")
SESSION_ACTIVITY_DISPLAY_PATH = root_resolver.project_runtime_display(PROJECT_ROOT, "session/activity.json")
SCOPES = {"session", "task", "project", "global"}
PRIVACY_CLASSES = {"public", "project_private", "sensitive"}
CONFIDENCE_LEVELS = {"low", "medium", "high"}
CANDIDATE_STATUSES = {"pending", "rejected"}
DIGEST_PRIORITIES = {"normal", "high"}
ACTIVITY_STATES = {"active", "post_turn", "quiescent"}
USER_PROFILE_STATUSES = {"enabled", "disabled"}
USER_PROFILE_PREFERENCE_KEYS = ("meaning_model", "communication", "workflow", "tool_use", "review_style")
MAX_PROFILE_CONTEXT_CHARS = 1400
MAX_PROFILE_CONTEXT_LINES = 8

__all__ = [
    "ROOT",
    "PROJECT_ROOT",
    "GLOBAL_ROOT",
    "PROJECT_RUNTIME_ROOT",
    "SIGNALS_PATH",
    "CANDIDATES_PATH",
    "DIGEST_PATH",
    "GLOBAL_DIGEST_PATH",
    "USER_PROFILE_PATH",
    "SESSION_ACTIVITY_PATH",
    "DISPLAY_PATH",
    "GLOBAL_DISPLAY_PATH",
    "USER_PROFILE_DISPLAY_PATH",
    "SIGNALS_DISPLAY_PATH",
    "CANDIDATES_DISPLAY_PATH",
    "SESSION_ACTIVITY_DISPLAY_PATH",
    "SCOPES",
    "PRIVACY_CLASSES",
    "CONFIDENCE_LEVELS",
    "CANDIDATE_STATUSES",
    "DIGEST_PRIORITIES",
    "ACTIVITY_STATES",
    "USER_PROFILE_STATUSES",
    "USER_PROFILE_PREFERENCE_KEYS",
    "MAX_PROFILE_CONTEXT_CHARS",
    "MAX_PROFILE_CONTEXT_LINES",
    "_compact_text",
    "_string_list",
    "_dedupe",
    "_load_activity",
    "_write_activity",
    "_record_event",
    "_value",
    "_require_value",
    "_parse_bool",
    "_parse_nonnegative_int",
    "_load_jsonl",
    "_write_jsonl",
    "_now",
]


def _compact_text(value: str, limit: int) -> str:
    compact = " ".join(value.strip().split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _string_list(value: Any) -> list[str] | None:
    if not isinstance(value, list):
        return None
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            return None
        result.append(" ".join(item.strip().split()))
    return result


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        compact = " ".join(value.strip().split())
        if not compact or compact in seen:
            continue
        seen.add(compact)
        result.append(compact)
    return result


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
