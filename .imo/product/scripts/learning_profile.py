from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from uuid import uuid4

from learning_common import (
    MAX_PROFILE_CONTEXT_CHARS,
    MAX_PROFILE_CONTEXT_LINES,
    USER_PROFILE_DISPLAY_PATH,
    USER_PROFILE_PATH,
    USER_PROFILE_PREFERENCE_KEYS,
    USER_PROFILE_STATUSES,
    _compact_text,
    _dedupe,
    _now,
    _require_value,
    _string_list,
    _value,
)


def _load_user_profile() -> tuple[dict[str, Any] | None, str | None]:
    if not USER_PROFILE_PATH.exists():
        return None, f"no user profile found at {USER_PROFILE_DISPLAY_PATH}"
    try:
        with USER_PROFILE_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid json in {USER_PROFILE_DISPLAY_PATH}: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"failed to read {USER_PROFILE_DISPLAY_PATH}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{USER_PROFILE_DISPLAY_PATH} must be a JSON object")
    return data, None


def _write_user_profile(profile: dict[str, Any]) -> None:
    USER_PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    USER_PROFILE_PATH.write_text(
        json.dumps(profile, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _validate_user_profile(profile: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if profile.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    for field in ("profile_id", "updated_at"):
        if not isinstance(profile.get(field), str) or not profile.get(field).strip():
            errors.append(f"{field} must be a non-empty string")
    if profile.get("status") not in USER_PROFILE_STATUSES:
        errors.append("status must be enabled or disabled")
    summary = profile.get("summary")
    if not isinstance(summary, dict):
        errors.append("summary must be an object")
    else:
        short_context = summary.get("short_context")
        if not isinstance(short_context, str) or not short_context.strip():
            errors.append("summary.short_context must be a non-empty string")
        elif len(" ".join(short_context.split())) > MAX_PROFILE_CONTEXT_CHARS:
            errors.append(f"summary.short_context must be at most {MAX_PROFILE_CONTEXT_CHARS} characters")
    preferences = profile.get("preferences")
    if not isinstance(preferences, dict):
        errors.append("preferences must be an object")
    else:
        for key in USER_PROFILE_PREFERENCE_KEYS:
            if _string_list(preferences.get(key)) is None:
                errors.append(f"preferences.{key} must be a list of non-empty strings")
    privacy = profile.get("privacy")
    if not isinstance(privacy, dict):
        errors.append("privacy must be an object")
    else:
        if privacy.get("scope") != "global":
            errors.append("privacy.scope must be global")
        if privacy.get("contains_project_private") is not False:
            errors.append("privacy.contains_project_private must be false")
    if _string_list(profile.get("source_refs")) is None:
        errors.append("source_refs must be a list of non-empty strings")
    return errors


def _base_user_profile(summary: str) -> dict[str, Any]:
    now = _now()
    return {
        "schema_version": 1,
        "profile_id": f"user-profile-{uuid4().hex}",
        "created_at": now,
        "updated_at": now,
        "status": "enabled",
        "display_name": None,
        "summary": {"short_context": _compact_text(summary, MAX_PROFILE_CONTEXT_CHARS)},
        "preferences": {key: [] for key in USER_PROFILE_PREFERENCE_KEYS},
        "privacy": {"scope": "global", "contains_project_private": False},
        "source_refs": [],
    }


def _parse_profile_update(args: list[str]) -> tuple[dict[str, Any], list[str]]:
    values: dict[str, Any] = {
        "summary": None,
        "display_name": None,
        "replace": False,
        "preferences": {key: [] for key in USER_PROFILE_PREFERENCE_KEYS},
        "source_refs": [],
    }
    option_to_key = {
        "--meaning": "meaning_model",
        "--communication": "communication",
        "--workflow": "workflow",
        "--tool-use": "tool_use",
        "--review-style": "review_style",
    }
    errors: list[str] = []
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--summary":
            value, index = _require_value(args, index, option)
            values["summary"] = value
        elif option == "--display-name":
            value, index = _require_value(args, index, option)
            values["display_name"] = value
        elif option == "--source-ref":
            value, index = _require_value(args, index, option)
            if value is not None:
                values["source_refs"].append(value)
        elif option in option_to_key:
            value, index = _require_value(args, index, option)
            if value is not None:
                values["preferences"][option_to_key[option]].append(value)
        elif option == "--replace":
            values["replace"] = True
            index += 1
        else:
            errors.append(f"unsupported profile update option: {option}")
            index += 1
    return values, errors


def _profile_status(args: list[str]) -> int:
    if args not in ([], ["--json"]):
        print("[imo learning] profile status supports only optional --json", file=sys.stderr)
        return 64
    as_json = args == ["--json"]
    try:
        profile, empty_reason = _load_user_profile()
    except ValueError as exc:
        if as_json:
            print(json.dumps({"status": "invalid", "path": USER_PROFILE_DISPLAY_PATH, "errors": [str(exc)]}, ensure_ascii=True, indent=2, sort_keys=True))
        else:
            print(f"[imo learning] invalid user profile: {exc}", file=sys.stderr)
        return 1
    if profile is None:
        payload = {"status": "missing", "path": USER_PROFILE_DISPLAY_PATH}
        if as_json:
            print(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True))
        else:
            print(f"[imo learning] {empty_reason}")
        return 0
    errors = _validate_user_profile(profile)
    if errors:
        payload = {"status": "invalid", "path": USER_PROFILE_DISPLAY_PATH, "errors": errors}
        if as_json:
            print(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True))
        else:
            print("[imo learning] invalid user profile", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
        return 1
    payload = {
        "status": profile.get("status"),
        "path": USER_PROFILE_DISPLAY_PATH,
        "profile_id": profile.get("profile_id"),
        "updated_at": profile.get("updated_at"),
    }
    if as_json:
        print(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True))
    else:
        print(f"status\t{payload['status']}")
        print(f"profile_id\t{payload['profile_id']}")
        print(f"updated_at\t{payload['updated_at']}")
        print(f"path\t{payload['path']}")
    return 0


def _profile_inspect(args: list[str]) -> int:
    if args not in ([], ["--json"]):
        print("[imo learning] profile inspect supports only optional --json", file=sys.stderr)
        return 64
    as_json = args == ["--json"]
    try:
        profile, empty_reason = _load_user_profile()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1
    if profile is None:
        if as_json:
            print(json.dumps({"status": "missing", "path": USER_PROFILE_DISPLAY_PATH}, ensure_ascii=True, indent=2, sort_keys=True))
        else:
            print(f"[imo learning] {empty_reason}")
        return 0
    errors = _validate_user_profile(profile)
    if errors:
        print("[imo learning] invalid user profile", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps(profile, ensure_ascii=True, indent=2, sort_keys=True))
        return 0

    print(f"profile_id\t{_value(profile, 'profile_id')}")
    print(f"status\t{_value(profile, 'status')}")
    print(f"updated_at\t{_value(profile, 'updated_at')}")
    display_name = profile.get("display_name")
    if isinstance(display_name, str) and display_name.strip():
        print(f"display_name\t{display_name.strip()}")
    summary = profile.get("summary", {})
    if isinstance(summary, dict):
        print(f"summary\t{_compact_text(str(summary.get('short_context', '')), MAX_PROFILE_CONTEXT_CHARS)}")
    preferences = profile.get("preferences", {})
    if isinstance(preferences, dict):
        for key in USER_PROFILE_PREFERENCE_KEYS:
            values = preferences.get(key, [])
            if isinstance(values, list) and values:
                print(key)
                for value in values:
                    print(f"- {value}")
    source_refs = profile.get("source_refs", [])
    if isinstance(source_refs, list) and source_refs:
        print("source_refs")
        for value in source_refs:
            print(f"- {value}")
    return 0


def _profile_update(args: list[str]) -> int:
    values, parse_errors = _parse_profile_update(args)
    errors = parse_errors
    summary = values.get("summary")
    has_preference_updates = any(values["preferences"][key] for key in USER_PROFILE_PREFERENCE_KEYS)
    has_source_refs = bool(values["source_refs"])
    if not isinstance(summary, str) and values.get("display_name") is None and not has_preference_updates and not has_source_refs:
        errors.append("profile update requires at least one field")
    if isinstance(summary, str) and not summary.strip():
        errors.append("--summary must not be empty")
    display_name = values.get("display_name")
    if display_name is not None and (not isinstance(display_name, str) or not display_name.strip()):
        errors.append("--display-name must not be empty")
    if errors:
        for error in errors:
            print(f"[imo learning] {error}", file=sys.stderr)
        return 64

    try:
        profile, _ = _load_user_profile()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1
    if profile is None:
        if not isinstance(summary, str) or not summary.strip():
            print("[imo learning] --summary is required when creating a user profile", file=sys.stderr)
            return 64
        profile = _base_user_profile(summary)
    else:
        validation_errors = _validate_user_profile(profile)
        if validation_errors:
            print("[imo learning] refusing to update invalid user profile", file=sys.stderr)
            for error in validation_errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        if isinstance(summary, str):
            profile["summary"] = {"short_context": _compact_text(summary, MAX_PROFILE_CONTEXT_CHARS)}

    if isinstance(display_name, str):
        profile["display_name"] = display_name.strip()
    preferences = profile.setdefault("preferences", {})
    for key in USER_PROFILE_PREFERENCE_KEYS:
        existing = preferences.get(key, [])
        if not isinstance(existing, list):
            existing = []
        incoming = values["preferences"][key]
        if values["replace"] and incoming:
            preferences[key] = _dedupe(incoming)
        else:
            preferences[key] = _dedupe([str(item) for item in existing] + incoming)
    source_refs = profile.get("source_refs", [])
    if not isinstance(source_refs, list):
        source_refs = []
    if values["replace"] and values["source_refs"]:
        profile["source_refs"] = _dedupe(values["source_refs"])
    else:
        profile["source_refs"] = _dedupe([str(item) for item in source_refs] + values["source_refs"])
    profile["privacy"] = {"scope": "global", "contains_project_private": False}
    profile["updated_at"] = _now()

    validation_errors = _validate_user_profile(profile)
    if validation_errors:
        for error in validation_errors:
            print(f"[imo learning] {error}", file=sys.stderr)
        return 1
    try:
        _write_user_profile(profile)
    except OSError as exc:
        print(f"[imo learning] failed to write {USER_PROFILE_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1
    print(_value(profile, "profile_id"))
    return 0


def _profile_toggle(status: str) -> int:
    try:
        profile, empty_reason = _load_user_profile()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1
    if profile is None:
        print(f"[imo learning] {empty_reason}", file=sys.stderr)
        return 1
    validation_errors = _validate_user_profile(profile)
    if validation_errors:
        print("[imo learning] refusing to toggle invalid user profile", file=sys.stderr)
        for error in validation_errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    profile["status"] = status
    profile["updated_at"] = _now()
    try:
        _write_user_profile(profile)
    except OSError as exc:
        print(f"[imo learning] failed to write {USER_PROFILE_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1
    print(status)
    return 0


def _profile_export(args: list[str]) -> int:
    output_path: Path | None = None
    if args:
        if len(args) != 2 or args[0] != "--output" or not args[1].strip():
            print("[imo learning] profile export supports optional --output <path>", file=sys.stderr)
            return 64
        output_path = Path(args[1]).expanduser()
    try:
        profile, empty_reason = _load_user_profile()
    except ValueError as exc:
        print(f"[imo learning] {exc}", file=sys.stderr)
        return 1
    if profile is None:
        print(f"[imo learning] {empty_reason}", file=sys.stderr)
        return 1
    validation_errors = _validate_user_profile(profile)
    if validation_errors:
        print("[imo learning] refusing to export invalid user profile", file=sys.stderr)
        for error in validation_errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    payload = json.dumps(profile, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    if output_path is None:
        print(payload, end="")
        return 0
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload, encoding="utf-8")
    except OSError as exc:
        print(f"[imo learning] failed to write {output_path}: {exc}", file=sys.stderr)
        return 1
    print(str(output_path))
    return 0


def _profile_import(args: list[str]) -> int:
    if len(args) != 2 or args[0] != "--input" or not args[1].strip():
        print("[imo learning] profile import requires --input <path>", file=sys.stderr)
        return 64
    input_path = Path(args[1]).expanduser()
    try:
        profile = json.loads(input_path.read_text(encoding="utf-8"))
    except OSError as exc:
        print(f"[imo learning] failed to read {input_path}: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"[imo learning] invalid json in {input_path}: {exc}", file=sys.stderr)
        return 1
    if not isinstance(profile, dict):
        print("[imo learning] imported profile must be a JSON object", file=sys.stderr)
        return 1
    validation_errors = _validate_user_profile(profile)
    if validation_errors:
        print("[imo learning] refusing to import invalid user profile", file=sys.stderr)
        for error in validation_errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    try:
        _write_user_profile(profile)
    except OSError as exc:
        print(f"[imo learning] failed to write {USER_PROFILE_DISPLAY_PATH}: {exc}", file=sys.stderr)
        return 1
    print(_value(profile, "profile_id"))
    return 0


def user_profile_context_lines(
    max_lines: int = MAX_PROFILE_CONTEXT_LINES,
    max_chars: int = MAX_PROFILE_CONTEXT_CHARS,
) -> list[str]:
    try:
        profile, _ = _load_user_profile()
    except ValueError:
        return []
    if profile is None or profile.get("status") != "enabled" or _validate_user_profile(profile):
        return []
    lines: list[str] = []
    summary = profile.get("summary", {})
    if isinstance(summary, dict):
        short_context = summary.get("short_context")
        if isinstance(short_context, str) and short_context.strip():
            lines.append(f"- summary: {_compact_text(short_context, min(360, max_chars))}")
    preferences = profile.get("preferences", {})
    if isinstance(preferences, dict):
        for key in USER_PROFILE_PREFERENCE_KEYS:
            values = preferences.get(key)
            if not isinstance(values, list) or not values:
                continue
            compact_values = [_compact_text(str(value), 180) for value in values[:2] if str(value).strip()]
            if compact_values:
                lines.append(f"- {key}: {'; '.join(compact_values)}")
            if len(lines) >= max_lines:
                break
    total = 0
    bounded: list[str] = []
    for line in lines:
        next_total = total + len(line)
        if next_total > max_chars:
            break
        bounded.append(line)
        total = next_total
        if len(bounded) >= max_lines:
            break
    return bounded
