#!/usr/bin/env python3
"""Identity veil: run identity-marked commands in a local black box.

The model-facing envelope never contains argv, cwd, or raw high-sensitivity
content. Host PreToolUse hooks call ``gate``; agents call ``run``/``read``
after the gate redirects them.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from typing import Any
from urllib.parse import urlsplit, parse_qsl
import uuid

import root_resolver


SOURCE_ROOT = Path(__file__).resolve().parents[3]
GLOBAL_ROOT = root_resolver.resolve_global_root()
POLICY_DIR = GLOBAL_ROOT / "runtime" / "identity-veil"
POLICY_PATH = POLICY_DIR / "policy.json"
GATE_HOOK_REL = Path("hooks/veil-gate.sh")
CONTEXT_HOOK_REL = Path("hooks/veil-context.sh")
CONTEXT_EVENT = "SessionStart"
MANIFEST_REL = Path("install/identity-veil/manifest.json")
SCHEMA_VERSION = 1
DEFAULT_TIMEOUT_SECONDS = 300

CLAUDE_EVENT = "PreToolUse"
CLAUDE_MATCHER = "Bash|Read|Grep|Glob"
CODEX_MATCHER = "shell|local_shell|Read|Grep|Glob"
SHELL_TOOL_NAMES = {"Bash", "shell", "local_shell"}
PATH_TOOL_NAMES = {"Read", "Grep", "Glob"}

REDACTED = "[REDACTED]"

# Built-in policy. The tracked framework deliberately contains NO organization
# identifiers (no real CLI names, hosts, or domains): real mappings live only in
# the user policy under ~/.imo, which is never committed or projected. The
# built-ins therefore provide the mechanism and organization-independent secret
# patterns only; `policy init` writes an editable template with neutral examples.
BUILTIN_COMMANDS: list[dict[str, str]] = []
BUILTIN_PATHS: list[dict[str, str]] = []
# Opaque patterns escalate the whole result; sanitize patterns replace text.
BUILTIN_PATTERNS = [
    {
        "name": "private-key-block",
        "pattern": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
        "level": "opaque",
    },
    {
        "name": "jwt",
        "pattern": r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
        "level": "opaque",
    },
    {
        "name": "bearer-token",
        "pattern": r"(?i)\b(bearer|token|api[_-]?key|secret)\s*[:=]\s*[A-Za-z0-9._\-]{12,}",
        "level": "opaque",
    },
    {
        "name": "cloud-access-key",
        "pattern": r"\b(?:AKIA|AGPA|ASIA|ghp_|gho_|glpat-|xox[baprs]-|tme_)[A-Za-z0-9\-_]{12,}",
        "level": "opaque",
    },
    {
        "name": "email",
        "pattern": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        "level": "sanitize",
        "replacement": "[REDACTED:email]",
    },
    {
        "name": "url-userinfo",
        "pattern": r"\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s/@?#]+:[^@\s/?#]+@",
        "level": "opaque",
    },
    {
        "name": "url-secret-params",
        "pattern": r"(?i)([?&](?:access_token|api_key|apikey|auth|auth_token|key|passwd|password|secret|session|sid|sig|sign|signature|token)=)[^&#\s\"'<>]*",
        "level": "sanitize",
        "replacement": r"\1[REDACTED]",
    },
]

# Neutral example entries written only by `policy init` into the user's local
# policy. They document the format with obviously-fake identifiers. Replace
# them with the real local mapping; never commit those values.
EXAMPLE_COMMANDS = [
    {
        "match": "example-org-cli",
        "alias": "org-cli-1",
        "description": "example: replace match with the real organization CLI basename",
        "action": "sanitize",
    }
]
EXAMPLE_PATHS = [
    {
        "prefix": "~/.example-org-cli",
        "alias": "org-config-1",
        "description": "example: replace prefix with the real CLI config directory",
        "action": "opaque",
    }
]
EXAMPLE_PATTERNS = [
    {
        "name": "example-internal-host",
        "pattern": r"[A-Za-z0-9.-]+\.example\.internal",
        "level": "sanitize",
        "replacement": "[REDACTED:internal-host]",
    }
]


def _usage() -> str:
    return """Usage:
  ./imo veil gate
  ./imo veil context
  ./imo veil register
  ./imo veil run --task <handle> [-- <args>]
  ./imo veil run -- <generic-command> [args...]
  ./imo veil read --task <handle> [--rel <path>]
  ./imo veil read <generic-path>
  ./imo veil check (--command <text> | --path <path>)
  ./imo veil status [--json] [--reveal]
  ./imo veil policy (path | init | show)
  ./imo veil selftest
  ./imo veil install [--apply] [--gate-only] [--host both|claude|codex]
  ./imo veil uninstall [--apply] [--host both|claude|codex]

Registered tools are addressed only by neutral handles; real names stay local.
`register` is interactive and should be run in your own terminal, not by an agent.
"""


def _dynamic_patterns() -> list[dict[str, str]]:
    patterns: list[dict[str, str]] = []
    home = Path.home()
    home_value = str(home)
    if home_value and home_value != "/":
        patterns.append(
            {
                "name": "home-path",
                "pattern": re.escape(home_value),
                "level": "sanitize",
                "replacement": "~",
            }
        )
    username = getpass.getuser()
    if username and len(username) >= 2:
        patterns.append(
            {
                "name": "username",
                "pattern": r"\b" + re.escape(username) + r"\b",
                "level": "sanitize",
                "replacement": "[REDACTED:user]",
            }
        )
    hostname = socket.gethostname()
    if hostname and "." in hostname:
        patterns.append(
            {
                "name": "hostname",
                "pattern": r"\b" + re.escape(hostname) + r"\b",
                "level": "sanitize",
                "replacement": "[REDACTED:host]",
            }
        )
    return patterns


def _default_policy() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "enabled": True,
        "commands": [dict(item) for item in BUILTIN_COMMANDS],
        "paths": [dict(item) for item in BUILTIN_PATHS],
        "patterns": [dict(item) for item in BUILTIN_PATTERNS],
    }


def _policy_template() -> dict[str, Any]:
    """User-policy seed written by `policy init`; holds neutral examples only."""
    policy = _default_policy()
    policy["commands"] = [dict(item) for item in EXAMPLE_COMMANDS]
    policy["paths"] = [dict(item) for item in EXAMPLE_PATHS]
    policy["patterns"] = [dict(item) for item in BUILTIN_PATTERNS] + [
        dict(item) for item in EXAMPLE_PATTERNS
    ]
    return policy


def _load_user_policy() -> tuple[dict[str, Any] | None, str | None]:
    if not POLICY_PATH.is_file():
        return None, None
    try:
        data = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"invalid user policy json: {exc}"
    if not isinstance(data, dict):
        return None, "user policy root must be an object"
    return data, None


def _valid_entry(item: Any, required: tuple[str, ...]) -> bool:
    return (
        isinstance(item, dict)
        and all(isinstance(item.get(field), str) and item.get(field) for field in required)
        and item.get("action", "sanitize") in {"sanitize", "opaque"}
    )


def merged_policy() -> tuple[dict[str, Any], list[str]]:
    """Merge built-ins, dynamic identity patterns, and user overrides."""
    policy = _default_policy()
    warnings: list[str] = []

    user, error = _load_user_policy()
    if error:
        warnings.append(error)
    if isinstance(user, dict):
        if user.get("enabled") is False:
            policy["enabled"] = False
        commands = list(policy["commands"])
        paths = list(policy["paths"])
        patterns = list(policy["patterns"])
        known_commands = {item["match"] for item in commands}
        known_paths = {item["prefix"] for item in paths}
        known_patterns = {item["name"] for item in patterns}
        for item in user.get("commands", []):
            if _valid_entry(item, ("match", "alias")) and item["match"] not in known_commands:
                commands.append(
                    {
                        "match": item["match"],
                        "alias": item["alias"],
                        "description": item.get("description", "registered organization command"),
                        "action": item.get("action", "sanitize"),
                    }
                )
                known_commands.add(item["match"])
        for item in user.get("paths", []):
            if _valid_entry(item, ("prefix", "alias")) and item["prefix"] not in known_paths:
                paths.append(
                    {
                        "prefix": item["prefix"],
                        "alias": item["alias"],
                        "description": item.get("description", "registered organization path"),
                        "action": item.get("action", "opaque"),
                    }
                )
                known_paths.add(item["prefix"])
        for item in user.get("patterns", []):
            if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item.get("name"):
                continue
            if not isinstance(item.get("pattern"), str) or not item.get("pattern"):
                warnings.append(f"pattern {item.get('name')} ignored: missing pattern")
                continue
            level = item.get("level", "sanitize")
            if level not in {"sanitize", "opaque"}:
                warnings.append(f"pattern {item['name']} ignored: bad level")
                continue
            entry = {
                "name": item["name"],
                "pattern": item["pattern"],
                "level": level,
                "replacement": item.get("replacement", f"[REDACTED:{item['name']}]"),
            }
            patterns = [p for p in patterns if p["name"] != entry["name"]]
            patterns.append(entry)
        policy["commands"] = commands
        policy["paths"] = paths
        policy["patterns"] = patterns

    for item in _identity_name_patterns(policy):
        policy["patterns"].append(item)
    for item in _dynamic_patterns():
        if item["name"] not in {p["name"] for p in policy["patterns"]}:
            policy["patterns"].append(item)
    return policy, warnings


def _identity_name_patterns(policy: dict[str, Any]) -> list[dict[str, str]]:
    """Redact a registered tool's own name everywhere, including help/errors.

    Without this, ``<tool> --help`` would echo the real basename. Every literal
    is replaced by its neutral handle so the model can still map help text to
    the handle.
    """
    patterns: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add(name: str, literal: str, handle: str) -> None:
        literal = literal.strip()
        if not literal or len(literal) < 2 or literal in seen:
            return
        seen.add(literal)
        patterns.append(
            {
                "name": f"identity-name-{name}",
                "pattern": re.escape(literal),
                "level": "sanitize",
                "replacement": handle,
            }
        )

    for item in policy.get("commands", []):
        match = item.get("match")
        alias = item.get("alias")
        if isinstance(match, str) and isinstance(alias, str):
            _add(alias, Path(match).name, alias)
    for item in policy.get("paths", []):
        prefix = item.get("prefix")
        alias = item.get("alias")
        if isinstance(prefix, str) and isinstance(alias, str):
            tail = Path(_expand_prefix(prefix)).name
            _add(alias, tail, alias)
    return patterns


def _compiled_patterns(policy: dict[str, Any]) -> tuple[list[tuple[str, re.Pattern[str], str]], list[tuple[str, re.Pattern[str]]], list[str]]:
    sanitizers: list[tuple[str, re.Pattern[str], str]] = []
    opacifiers: list[tuple[str, re.Pattern[str]]] = []
    warnings: list[str] = []
    for item in policy.get("patterns", []):
        try:
            regex = re.compile(item["pattern"])
        except (re.error, TypeError):
            warnings.append(f"pattern {item.get('name')} ignored: invalid regex")
            continue
        if item.get("level") == "opaque":
            opacifiers.append((item["name"], regex))
        else:
            sanitizers.append((item["name"], regex, item.get("replacement", REDACTED)))
    return sanitizers, opacifiers, warnings


def _expand_prefix(prefix: str) -> str:
    return str(Path(prefix).expanduser())


def _expand_path_literals(text: str) -> list[str]:
    """Expand ~ and $HOME inside a command string for prefix testing only."""
    home = str(Path.home())
    candidates = {text}
    variants = (
        (os.environ.get("HOME", ""), home),
        ("~", home),
        ("$HOME", home),
        ("${HOME}", home),
    )
    expanded = text
    for old, new in variants:
        if old and new:
            expanded = expanded.replace(old, new)
    candidates.add(expanded)
    return [candidate for candidate in candidates if candidate]


def classify_command(text: str, policy: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(text, str) or not text.strip():
        return None
    for item in policy.get("paths", []):
        prefix = _expand_prefix(item["prefix"])
        if any(prefix in candidate for candidate in _expand_path_literals(text)):
            return {
                "channel": "path",
                "matched": item["prefix"],
                "alias": item["alias"],
                "action": item.get("action", "opaque"),
                "rewrite": f"./imo veil read --task {item['alias']}",
            }
    for item in policy.get("commands", []):
        name = item["match"]
        regex = re.compile(r"(?:^|[\s;|&()])" + re.escape(name) + r"(?:\s|$)")
        first_token = Path(text.split()[0]).name if text.split() else ""
        if regex.search(text) or first_token == name:
            return {
                "channel": "command",
                "matched": name,
                "alias": item["alias"],
                "action": item.get("action", "sanitize"),
                "rewrite": f"./imo veil run --task {item['alias']} -- <same arguments>",
            }
    return None


def resolve_command_alias(alias: str, policy: dict[str, Any]) -> str | None:
    for item in policy.get("commands", []):
        if item.get("alias") == alias:
            return item["match"]
    return None


def classify_path(target: str, policy: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(target, str) or not target.strip():
        return None
    expanded = _expand_prefix(target)
    for item in policy.get("paths", []):
        prefix = _expand_prefix(item["prefix"])
        if expanded == prefix or expanded.startswith(prefix.rstrip("/") + "/") or expanded.startswith(prefix):
            return {
                "channel": "path",
                "matched": item["prefix"],
                "alias": item["alias"],
                "action": item.get("action", "opaque"),
                "rewrite": f"./imo veil read --task {item['alias']}",
            }
    return None


def resolve_path_alias(alias: str, policy: dict[str, Any]) -> str | None:
    for item in policy.get("paths", []):
        if item.get("alias") == alias:
            return _expand_prefix(item["prefix"])
    return None


def classify_payload(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any] | None:
    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if not isinstance(tool_name, str) or not isinstance(tool_input, dict):
        return None
    if tool_name in SHELL_TOOL_NAMES:
        command = tool_input.get("command")
        if isinstance(command, str):
            return classify_command(command, policy)
        commands = tool_input.get("commands")
        if isinstance(commands, list) and any(isinstance(part, str) for part in commands):
            for part in commands:
                if isinstance(part, str):
                    match = classify_command(part, policy)
                    if match:
                        return match
        return None
    if tool_name in PATH_TOOL_NAMES:
        target = tool_input.get("file_path") or tool_input.get("path")
        if isinstance(target, str):
            return classify_path(target, policy)
    return None


def _redact(text: str, policy: dict[str, Any], forced_level: str | None = None) -> dict[str, Any]:
    sanitizers, opacifiers, warnings = _compiled_patterns(policy)
    opaque_hits = [name for name, regex in opacifiers if regex.search(text)]
    if forced_level == "opaque" or opaque_hits:
        return {
            "level": "opaque",
            "opaque_matches": sorted(set(opaque_hits)) or ["forced"],
            "warnings": warnings,
        }
    redacted = text
    counts: dict[str, int] = {}
    for name, regex, replacement in sanitizers:
        redacted, count = regex.subn(replacement, redacted)
        if count:
            counts[name] = count
    return {
        "level": "sanitize" if counts else "clear",
        "text": redacted,
        "redactions": [{"name": name, "count": count} for name, count in sorted(counts.items())],
        "warnings": warnings,
    }


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()


def _envelope(*, level: str, exit_code: int, stdout_result: dict[str, Any], stderr_result: dict[str, Any],
              duration_ms: int, timed_out: bool = False) -> dict[str, Any]:
    envelope: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "level": level,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "timed_out": timed_out,
        "stderr_level": stderr_result["level"],
        "warnings": sorted(set(stdout_result.get("warnings", []) + stderr_result.get("warnings", []))),
    }
    if timed_out:
        envelope["note"] = "command exceeded timeout and was terminated"
    if level == "opaque":
        envelope["stdout"] = {
            "bytes": None,
            "hidden": True,
        }
    else:
        envelope["stdout"] = {"text": stdout_result.get("text", ""), "hidden": False}
    if stderr_result["level"] == "opaque":
        envelope["stderr"] = {"hidden": True}
    else:
        envelope["stderr"] = {"text": stderr_result.get("text", ""), "hidden": False}
    return envelope


def _command_action(alias: str, policy: dict[str, Any]) -> str | None:
    for item in policy.get("commands", []):
        if item.get("alias") == alias:
            return item.get("action", "sanitize")
    return None


def _run_veiled(
    policy: dict[str, Any],
    timeout: int,
    *,
    task: str | None = None,
    raw_argv: list[str] | None = None,
) -> int:
    if task is not None:
        real_command = resolve_command_alias(task, policy)
        if real_command is None:
            print(f"[imo veil] unknown task handle: {task}; list handles with ./imo veil status", file=sys.stderr)
            return 64
        forced = _command_action(task, policy)
        argv = [real_command, *(raw_argv or [])]
    else:
        argv = list(raw_argv or [])
        if not argv:
            print("[imo veil] run requires --task <handle> or -- <command>", file=sys.stderr)
            return 64
        first = Path(argv[0]).name
        if any(item["match"] == first for item in policy.get("commands", [])):
            print(
                "[imo veil] registered commands must be invoked by neutral handle; "
                "run ./imo veil status and retry with --task <handle>",
                file=sys.stderr,
            )
            return 64
        forced = None

    start = time.monotonic()
    timed_out = False
    try:
        completed = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=timeout,
            text=True,
            errors="replace",
        )
        exit_code = completed.returncode
        raw_stdout = completed.stdout or ""
        raw_stderr = completed.stderr or ""
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        exit_code = 124
        raw_stdout = exc.stdout.decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        raw_stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
    duration_ms = int((time.monotonic() - start) * 1000)

    stdout_result = _redact(raw_stdout, policy, forced_level=forced)
    stderr_result = _redact(raw_stderr, policy, forced_level=forced)
    level = "opaque" if stdout_result["level"] == "opaque" or stderr_result["level"] == "opaque" else (
        "sanitize" if stdout_result["level"] == "sanitize" or stderr_result["level"] == "sanitize" else "clear"
    )
    if level == "opaque":
        stdout_result["bytes"] = len(raw_stdout.encode("utf-8", "replace"))
        stdout_result["lines"] = raw_stdout.count("\n") + (1 if raw_stdout else 0)
        stdout_result["sha256"] = _sha256(raw_stdout)
    envelope = _envelope(
        level=level,
        exit_code=exit_code,
        stdout_result=stdout_result,
        stderr_result=stderr_result,
        duration_ms=duration_ms,
        timed_out=timed_out,
    )
    if task is not None:
        envelope["task"] = task
    if level == "opaque":
        envelope["stdout"].update(
            {
                "bytes": stdout_result["bytes"],
                "lines": stdout_result["lines"],
                "sha256": stdout_result["sha256"],
                "opaque_matches": stdout_result.get("opaque_matches") or stderr_result.get("opaque_matches"),
            }
        )
    print(json.dumps(envelope, ensure_ascii=True, indent=2, sort_keys=True))
    return exit_code


def _read_veiled(policy: dict[str, Any], *, task: str | None = None, target: str | None = None,
                 relative: str | None = None) -> int:
    if task is not None:
        prefix = resolve_path_alias(task, policy)
        if prefix is None:
            print(f"[imo veil] unknown path handle: {task}; list handles with ./imo veil status", file=sys.stderr)
            return 64
        base = Path(prefix)
        candidate = (base / (relative or "")).resolve(strict=False)
        try:
            candidate.relative_to(base.resolve(strict=False))
        except ValueError:
            print("[imo veil] path handle scope escape refused", file=sys.stderr)
            return 64
        path = candidate
        forced = next(
            (item.get("action", "opaque") for item in policy.get("paths", []) if item.get("alias") == task),
            "opaque",
        )
    else:
        if not target:
            print("[imo veil] read requires --task <handle> or a path", file=sys.stderr)
            return 64
        if classify_path(target, policy) is not None:
            print(
                "[imo veil] registered paths must be read by neutral handle; "
                "run ./imo veil status and retry with --task <handle>",
                file=sys.stderr,
            )
            return 64
        path = Path(target).expanduser()
        forced = None
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        shown = "<identity-path>" if task is not None else str(path)
        print(f"[imo veil] cannot read {shown}: {exc.__class__.__name__}", file=sys.stderr)
        return 1
    result = _redact(raw, policy, forced_level=forced)
    if result["level"] == "opaque":
        payload = {
            "schema_version": SCHEMA_VERSION,
            "level": "opaque",
            "task": task,
            "bytes": len(raw.encode("utf-8", "replace")),
            "lines": raw.count("\n") + (1 if raw else 0),
            "sha256": _sha256(raw),
            "opaque_matches": result.get("opaque_matches"),
            "warnings": result.get("warnings", []),
        }
    else:
        payload = {
            "schema_version": SCHEMA_VERSION,
            "level": result["level"],
            "task": task,
            "text": result.get("text", ""),
            "redactions": result.get("redactions", []),
            "warnings": result.get("warnings", []),
        }
    print(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True))
    return 0


def _gate() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    if not isinstance(payload, dict) or payload.get("hook_event_name") != CLAUDE_EVENT:
        return 0
    policy, _warnings = merged_policy()
    if not policy["enabled"]:
        return 0
    match = classify_payload(payload, policy)
    if not match:
        return 0
    if match["channel"] == "path" and _is_path_tool(payload.get("tool_name")):
        reason = (
            "[imo veil] blocked identity-marked file read. If the task truly needs this file, "
            "retry through the black box: " + match["rewrite"]
        )
    else:
        reason = (
            "[imo veil] blocked identity-marked command. Retry through the black box without "
            "revealing its name in your own text: " + match["rewrite"]
        )
    print(reason, file=sys.stderr)
    return 2


def _is_path_tool(tool_name: Any) -> bool:
    return tool_name in PATH_TOOL_NAMES


def _check(args: argparse.Namespace) -> int:
    policy, warnings = merged_policy()
    if args.command_text is not None:
        match = classify_command(args.command_text, policy)
    else:
        match = classify_path(args.target_path or "", policy)
    result = {"verdict": "deny" if match else "allow", "match": match, "warnings": warnings}
    print(json.dumps(result, ensure_ascii=True, indent=2, sort_keys=True))
    return 0


def _status(as_json: bool, reveal: bool = False) -> int:
    policy, warnings = merged_policy()
    hosts = _registration_states()

    def _project_commands() -> list[dict[str, Any]]:
        entries = []
        for item in policy.get("commands", []):
            entry: dict[str, Any] = {
                "task": item.get("alias"),
                "kind": "command",
                "action": item.get("action", "sanitize"),
                "description": item.get("description", "registered organization command"),
            }
            if reveal:
                entry["match"] = item["match"]
            entries.append(entry)
        return entries

    def _project_paths() -> list[dict[str, Any]]:
        entries = []
        for item in policy.get("paths", []):
            entry = {
                "task": item.get("alias"),
                "kind": "path",
                "action": item.get("action", "opaque"),
                "description": item.get("description", "registered organization path"),
            }
            if reveal:
                entry["prefix"] = item["prefix"]
            entries.append(entry)
        return entries

    payload = {
        "enabled": bool(policy["enabled"]),
        "policy_path": str(POLICY_PATH),
        "user_policy_present": POLICY_PATH.is_file(),
        "reveals_real_names": bool(reveal),
        "commands": _project_commands(),
        "paths": _project_paths(),
        "patterns": [
            {"name": item["name"], "level": item.get("level", "sanitize")}
            for item in policy["patterns"]
        ],
        "hosts": hosts,
        "warnings": warnings,
    }
    if as_json:
        print(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True))
    else:
        print(f"enabled\tyes" if payload["enabled"] else "enabled\tno")
        print(f"policy\t{POLICY_PATH} ({'present' if POLICY_PATH.is_file() else 'built-in only'})")
        for entry in (*payload["commands"], *payload["paths"]):
            print(f"{entry['task']}\t{entry['kind']}\t{entry['action']}\t{entry['description']}")
        for host, state in sorted(hosts.items()):
            print(f"{host}\t{state}")
        for warning in warnings:
            print(f"warning\t{warning}")
    return 0


def _context() -> int:
    """Model-facing capability announcement. No real names, ever."""
    policy, warnings = merged_policy()
    lines = [
        "<imo-veil>",
        "An identity veil is active. Some organization CLIs and credential files are",
        "available only as neutral handles; never guess, type, or search for their real",
        "names or paths, and never run them directly.",
    ]
    handles = [
        *(("command", item) for item in policy.get("commands", [])),
        *(("path", item) for item in policy.get("paths", [])),
    ]
    if not policy.get("enabled"):
        lines.append("Status: disabled by local policy; the veil gate allows all calls.")
    elif not handles:
        lines.append("No identity tools are registered yet on this machine.")
    else:
        lines.append("Handles (the only way to refer to these tools):")
        for kind, item in handles:
            handle = item.get("alias", "?")
            action = item.get("action", "sanitize")
            description = item.get("description", f"registered {kind}")
            lines.append(f"- {handle} ({kind}, output={action}): {description}")
        lines.extend(
            [
                "Usage:",
                "- run: ./imo veil run --task <handle> -- <args>",
                "- learn a CLI's own subcommands safely: ./imo veil run --task <handle> -- --help",
                "- read: ./imo veil read --task <handle> [--rel <relative-path>]",
                "- list handles: ./imo veil status",
                "sanitize output has values replaced by placeholders; opaque output returns only",
                "size and a hash. Do not try to recover opaque bytes; if a step truly needs",
                "them, ask the user to run that step locally.",
            ]
        )
    for warning in warnings:
        lines.append(f"warning: {warning}")
    lines.append("</imo-veil>")
    print("\n".join(lines))
    return 0


def _policy_command(args: argparse.Namespace) -> int:
    if args.policy_action == "path":
        print(POLICY_PATH)
        return 0
    if args.policy_action == "show":
        policy, warnings = merged_policy()
        print(json.dumps(policy, ensure_ascii=True, indent=2, sort_keys=True))
        for warning in warnings:
            print(f"warning: {warning}", file=sys.stderr)
        return 0 if not warnings else 0
    POLICY_DIR.mkdir(parents=True, exist_ok=True)
    if POLICY_PATH.exists():
        print(f"[imo veil] policy already exists: {POLICY_PATH}", file=sys.stderr)
        return 1
    POLICY_PATH.write_text(
        json.dumps(_policy_template(), ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"[imo veil] wrote editable policy template: {POLICY_PATH}")
    print("[imo veil] replace the example-org-cli/example.internal placeholders with the real local mapping")
    return 0


# ---------------------------------------------------------------------------
# Local interactive registration (real names never pass through argv/context)
# ---------------------------------------------------------------------------


def _secret_prompt(label: str) -> str:
    try:
        return getpass.getpass(label)
    except (EOFError, KeyboardInterrupt):
        print()
        return ""


def _plain_prompt(label: str, default: str = "") -> str:
    try:
        value = input(label)
    except (EOFError, KeyboardInterrupt):
        print()
        return default
    return value.strip() or default


def _next_handle(prefix: str, items: list[dict[str, Any]]) -> str:
    used = {item.get("alias") for item in items if isinstance(item, dict)}
    index = 1
    while f"{prefix}-{index}" in used:
        index += 1
    return f"{prefix}-{index}"


def _editable_user_policy() -> dict[str, Any]:
    """Load the user policy for editing, dropping example placeholders."""
    user, _error = _load_user_policy()
    if isinstance(user, dict) and isinstance(user.get("commands"), list):
        base = user
    else:
        base = _default_policy()
    policy = {
        "schema_version": SCHEMA_VERSION,
        "enabled": bool(base.get("enabled", True)),
        "commands": [dict(i) for i in base.get("commands", []) if not str(i.get("match", "")).startswith("example-")],
        "paths": [dict(i) for i in base.get("paths", []) if "example" not in str(i.get("prefix", ""))],
        "patterns": [dict(i) for i in base.get("patterns", []) if "example" not in str(i.get("name", ""))],
    }
    return policy


def _save_user_policy(policy: dict[str, Any]) -> None:
    POLICY_DIR.mkdir(parents=True, exist_ok=True)
    POLICY_PATH.write_text(
        json.dumps(policy, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _register_command(policy: dict[str, Any]) -> str | None:
    raw = _secret_prompt(
        "Real command name or absolute path (local only, hidden from the model): "
    ).strip()
    if not raw:
        print("[imo veil] cancelled")
        return None
    basename = Path(raw).name
    if any(item.get("match") == basename for item in policy["commands"]):
        print(f"[imo veil] that command is already registered; check ./imo veil status --reveal")
        return None
    resolved = shutil.which(basename) or shutil.which(raw)
    if not resolved:
        if _plain_prompt(f"'{basename}' not found on PATH; register anyway? [y/N]: ") != "y":
            return None
    handle = _next_handle("org-cli", policy["commands"])
    print(f"Assigned neutral handle: {handle}")
    description = _plain_prompt(
        "Model-visible purpose (NO company/tool names, e.g. 'internal dev CLI: auth and services'): "
    ) or "registered organization command"
    action = _plain_prompt("Output level [sanitize/opaque] (default sanitize): ", "sanitize")
    if action not in {"sanitize", "opaque"}:
        action = "sanitize"
    policy["commands"].append(
        {"match": basename, "alias": handle, "description": description, "action": action}
    )
    if _plain_prompt("Also register its config/credential directory? [y/N]: ") == "y":
        suggested = f"~/.{basename}"
        raw_path = _secret_prompt(f"Real config directory (local only, Enter for {suggested}): ").strip()
        prefix = raw_path or suggested
        if not any(item.get("prefix") == prefix for item in policy["paths"]):
            path_handle = _next_handle("org-config", policy["paths"])
            path_desc = _plain_prompt("Model-visible purpose for the directory (no real names): ") or (
                f"credentials and config for {handle}"
            )
            policy["paths"].append(
                {"prefix": prefix, "alias": path_handle, "description": path_desc, "action": "opaque"}
            )
            print(f"Registered directory under handle: {path_handle}")
    return handle


def _register_path(policy: dict[str, Any]) -> str | None:
    prefix = _secret_prompt("Real directory or file path (local only, hidden from the model): ").strip()
    if not prefix:
        print("[imo veil] cancelled")
        return None
    if any(item.get("prefix") == prefix for item in policy["paths"]):
        print("[imo veil] that path is already registered")
        return None
    handle = _next_handle("org-config", policy["paths"])
    print(f"Assigned neutral handle: {handle}")
    description = _plain_prompt("Model-visible purpose (no real names): ") or "registered identity directory"
    action = _plain_prompt("Read output level [sanitize/opaque] (default opaque): ", "opaque")
    if action not in {"sanitize", "opaque"}:
        action = "opaque"
    policy["paths"].append(
        {"prefix": prefix, "alias": handle, "description": description, "action": action}
    )
    return handle


def _register() -> int:
    if not sys.stdin.isatty():
        print(
            "[imo veil] register is interactive; run it in your own terminal, for example with:\n"
            "  ! ./imo veil register\n"
            "The real name is typed only there and never enters the agent conversation.",
            file=sys.stderr,
        )
        return 64
    kind = _plain_prompt("Register [1] a command, or [2] a credential/config directory? [1/2]: ", "1")
    policy = _editable_user_policy()
    handle = _register_command(policy) if kind != "2" else _register_path(policy)
    if not handle:
        return 1 if kind not in {"1", "2"} else 0
    _save_user_policy(policy)
    print(f"[imo veil] saved local policy: {POLICY_PATH}")
    print(f"[imo veil] the model refers to it only as {handle}; verify with ./imo veil status")
    print(
        "[imo veil] first-use calibration: run the tool's --help yourself once and add any\n"
        "  organization words still visible in it to this policy's patterns, or set its\n"
        "  action to opaque, before letting a model rely on the handle."
    )
    return 0


# ---------------------------------------------------------------------------
# Host registration (opt-in, independent of global install)
# ---------------------------------------------------------------------------


def _gate_hook_text() -> str:
    return f"""#!/usr/bin/env bash
set -euo pipefail

command -v python3 >/dev/null 2>&1 || exit 0
payload="$(cat 2>/dev/null || true)"
[ -n "${{payload}}" ] || exit 0
printf '%s' "$payload" | python3 "{SOURCE_ROOT}/.imo/product/scripts/identity_veil.py" gate
"""


def _context_hook_text() -> str:
    return f"""#!/usr/bin/env bash
set -euo pipefail

command -v python3 >/dev/null 2>&1 || exit 0
python3 "{SOURCE_ROOT}/.imo/product/scripts/identity_veil.py" context 2>/dev/null || true
"""


def _claude_settings_path(claude_home: str | None) -> Path:
    if claude_home:
        return Path(claude_home).expanduser() / "settings.json"
    return Path(os.environ.get("CLAUDE_HOME", "~/.claude")).expanduser() / "settings.json"


def _codex_hooks_path(codex_root: str | None) -> Path:
    raw = codex_root or os.environ.get("CODEX_HOME") or "~/.codex"
    return Path(raw).expanduser() / "hooks.json"


def _host_targets(args: argparse.Namespace) -> dict[str, Path]:
    selected = args.host or "both"
    targets: dict[str, Path] = {}
    if selected in {"both", "claude"}:
        targets["claude"] = _claude_settings_path(getattr(args, "claude_home", None))
    if selected in {"both", "codex"}:
        targets["codex"] = _codex_hooks_path(getattr(args, "codex_root", None))
    return targets


def _load_json_object(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    if not path.is_file():
        return {}, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return None, f"invalid json: {exc}"
    if not isinstance(data, dict):
        return None, "root must be an object"
    return data, None


def _event_entries(data: dict[str, Any], event: str) -> list[dict[str, Any]]:
    events = data.setdefault("hooks", {})
    if not isinstance(events, dict):
        raise ValueError("hooks field must be an object")
    entries = events.setdefault(event, [])
    if not isinstance(entries, list):
        raise ValueError(f"{event} must be a list")
    return entries


def _hook_specs(host: str, gate_command: str, context_command: str, *, with_context: bool) -> list[dict[str, Any]]:
    matcher = CODEX_MATCHER if host == "codex" else CLAUDE_MATCHER
    specs = [
        {"event": CLAUDE_EVENT, "matcher": matcher, "command": gate_command, "hook_file": GATE_HOOK_REL.as_posix()},
    ]
    if with_context:
        specs.append(
            {"event": CONTEXT_EVENT, "matcher": None, "command": context_command, "hook_file": CONTEXT_HOOK_REL.as_posix()}
        )
    return specs


def _entry_commands(entry: dict[str, Any]) -> list[str]:
    return [
        hook.get("command")
        for hook in (entry.get("hooks", []) if isinstance(entry, dict) else [])
        if isinstance(hook, dict)
    ]


def _registration_present(data: dict[str, Any], spec: dict[str, Any]) -> bool:
    try:
        entries = _event_entries(data, spec["event"])
    except ValueError:
        return False
    for entry in entries:
        if spec["command"] not in _entry_commands(entry):
            continue
        if spec["matcher"] is None or entry.get("matcher") in (None, spec["matcher"]):
            return True
    return False


def _upsert_registration(data: dict[str, Any], spec: dict[str, Any]) -> None:
    entries = _event_entries(data, spec["event"])
    command = spec["command"]
    entries[:] = [
        entry for entry in entries
        if command not in _entry_commands(entry)
    ]
    entry: dict[str, Any] = {"hooks": [{"type": "command", "command": command, "timeout": 5}]}
    if spec["matcher"]:
        entry["matcher"] = spec["matcher"]
    entries.append(entry)


def _remove_registration(data: dict[str, Any], spec: dict[str, Any]) -> None:
    entries = _event_entries(data, spec["event"])
    command = spec["command"]
    kept: list[dict[str, Any]] = []
    for entry in entries:
        hooks = [
            hook
            for hook in (entry.get("hooks", []) if isinstance(entry, dict) else [])
            if not (isinstance(hook, dict) and hook.get("command") == command)
        ]
        if hooks:
            entry["hooks"] = hooks
            kept.append(entry)
    entries[:] = kept


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _manifest_path() -> Path:
    return GLOBAL_ROOT / MANIFEST_REL


def _load_manifest() -> dict[str, Any]:
    path = _manifest_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _gate_command() -> str:
    return str(GLOBAL_ROOT / GATE_HOOK_REL)


def _context_command() -> str:
    return str(GLOBAL_ROOT / CONTEXT_HOOK_REL)


def _recorded_specs(host: str, record: dict[str, Any]) -> list[dict[str, Any]]:
    gate_command = _gate_command()
    context_command = _context_command()
    with_context = bool(record.get("with_context", True))
    raw_hooks = record.get("hooks")
    if isinstance(raw_hooks, list) and raw_hooks:
        specs = []
        for item in raw_hooks:
            if not isinstance(item, dict) or not isinstance(item.get("command"), str):
                continue
            specs.append(
                {
                    "event": item.get("event", CLAUDE_EVENT),
                    "matcher": item.get("matcher"),
                    "command": item["command"],
                }
            )
        if specs:
            return specs
    return _hook_specs(host, gate_command, context_command, with_context=with_context)


def _registration_states() -> dict[str, str]:
    states: dict[str, str] = {}
    manifest = _load_manifest()
    hosts = manifest.get("hosts", {})
    plans = {
        "claude": _claude_settings_path(None),
        "codex": _codex_hooks_path(None),
    }
    for host, default_path in plans.items():
        record = hosts.get(host, {}) if isinstance(hosts, dict) else {}
        path = Path(record["path"]).expanduser() if isinstance(record, dict) and record.get("path") else default_path
        data, error = _load_json_object(path)
        if error or data is None:
            states[host] = "conflict"
            continue
        specs = _recorded_specs(host, record if isinstance(record, dict) else {})
        registered = [spec for spec in specs if _registration_present(data, spec)]
        hook_files = {
            GATE_HOOK_REL: (GLOBAL_ROOT / GATE_HOOK_REL).is_file(),
            CONTEXT_HOOK_REL: (GLOBAL_ROOT / CONTEXT_HOOK_REL).is_file(),
        }
        wants_context = any(spec["event"] == CONTEXT_EVENT for spec in specs)
        needed_files_ok = hook_files[GATE_HOOK_REL] and (not wants_context or hook_files[CONTEXT_HOOK_REL])
        if not registered and not record:
            states[host] = "not_installed"
        elif len(registered) == len(specs) and needed_files_ok:
            states[host] = "present"
        elif registered:
            states[host] = "stale"
        else:
            states[host] = "missing"
    return states


def _install(args: argparse.Namespace) -> int:
    targets = _host_targets(args)
    gate_command = _gate_command()
    context_command = _context_command()
    gate_hook_path = GLOBAL_ROOT / GATE_HOOK_REL
    context_hook_path = GLOBAL_ROOT / CONTEXT_HOOK_REL
    with_context = not bool(getattr(args, "gate_only", False))
    apply = bool(args.apply)
    print(f"[imo veil] install {'apply' if apply else 'dry-run'}")
    print(f"[imo veil] gate hook: {gate_hook_path}")
    if with_context:
        print(f"[imo veil] context hook: {context_hook_path}")

    loaded: dict[str, tuple[dict[str, Any], Path]] = {}
    for host, path in targets.items():
        data, error = _load_json_object(path)
        if error:
            print(f"[imo veil] refused, {host} settings unreadable at {path}: {error}", file=sys.stderr)
            return 1
        loaded[host] = (data or {}, path)
        events = f"{CLAUDE_EVENT} gate" + (f" plus {CONTEXT_EVENT} announcement" if with_context else "")
        print(f"[imo veil] {host}: register {events} in {path}")

    if not apply:
        print("[imo veil] pass --apply to write the hook(s) and registrations")
        return 0

    gate_hook_path.parent.mkdir(parents=True, exist_ok=True)
    gate_hook_path.write_text(_gate_hook_text(), encoding="utf-8")
    gate_hook_path.chmod(0o755)
    if with_context:
        context_hook_path.write_text(_context_hook_text(), encoding="utf-8")
        context_hook_path.chmod(0o755)

    hosts_record: dict[str, Any] = {}
    for host, (data, path) in loaded.items():
        specs = _hook_specs(host, gate_command, context_command, with_context=with_context)
        for spec in specs:
            _upsert_registration(data, spec)
        _write_json(path, data)
        hosts_record[host] = {
            "path": str(path),
            "with_context": with_context,
            "hooks": [
                {"event": spec["event"], "matcher": spec["matcher"], "command": spec["command"]}
                for spec in specs
            ],
        }

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "install_id": f"veil-{uuid.uuid4().hex}",
        "source_root": str(SOURCE_ROOT),
        "with_context": with_context,
        "hook_files": {
            GATE_HOOK_REL.as_posix(): hashlib.sha256(gate_hook_path.read_bytes()).hexdigest(),
            **(
                {CONTEXT_HOOK_REL.as_posix(): hashlib.sha256(context_hook_path.read_bytes()).hexdigest()}
                if with_context else {}
            ),
        },
        "hosts": hosts_record,
    }
    manifest_path = _manifest_path()
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[imo veil] install complete; manifest: {manifest_path}")
    policy, _warnings = merged_policy()
    if not policy.get("commands") and not policy.get("paths"):
        print(
            "[imo veil] no identity tools registered yet; run ./imo veil register in your own terminal, "
            "or ./imo veil policy init, then re-check ./imo veil status",
        )
    return 0


def _uninstall(args: argparse.Namespace) -> int:
    targets = _host_targets(args)
    gate_command = _gate_command()
    context_command = _context_command()
    apply = bool(args.apply)
    manifest = _load_manifest()
    print(f"[imo veil] uninstall {'apply' if apply else 'dry-run'}")
    for host, default_path in targets.items():
        recorded = manifest.get("hosts", {}).get(host, {})
        path = Path(recorded["path"]).expanduser() if isinstance(recorded, dict) and recorded.get("path") else default_path
        data, error = _load_json_object(path)
        if error:
            print(f"[imo veil] {host}: leaving unreadable settings untouched: {path}", file=sys.stderr)
            continue
        if not data:
            print(f"[imo veil] {host}: no settings at {path}")
            continue
        print(f"[imo veil] {host}: remove only IMO veil registration from {path}")
        if apply:
            with_context = bool(recorded.get("with_context", True)) if isinstance(recorded, dict) else True
            specs = _recorded_specs(host, recorded if isinstance(recorded, dict) else {})
            # Also clear a context hook left by a prior install even if manifest
            # predates it; removal is keyed by command and is idempotent.
            for spec in specs:
                _remove_registration(data, spec)
            for extra in _hook_specs(host, gate_command, context_command, with_context=not with_context):
                _remove_registration(data, extra)
            _write_json(path, data)
    if apply:
        for hook_rel in (GATE_HOOK_REL, CONTEXT_HOOK_REL):
            hook_path = GLOBAL_ROOT / hook_rel
            if hook_path.is_file():
                hook_path.unlink()
        remaining_hosts = {
            host: record
            for host, record in (manifest.get("hosts", {}) if isinstance(manifest.get("hosts"), dict) else {}).items()
            if host not in targets
        }
        manifest_path = _manifest_path()
        if remaining_hosts:
            manifest["hosts"] = remaining_hosts
            manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        elif manifest_path.is_file():
            manifest_path.unlink()
    print("[imo veil] uninstall complete; third-party hooks preserved")
    return 0


# ---------------------------------------------------------------------------
# Selftest
# ---------------------------------------------------------------------------


def _selftest() -> int:
    base, _warnings = merged_policy()
    failures: list[str] = []

    def expect(condition: bool, label: str) -> None:
        if not condition:
            failures.append(label)

    # Tracked built-ins must carry no organization identifiers; real mappings
    # are user-policy-only.
    expect(_default_policy()["commands"] == [], "built-in command map must be empty")
    expect(_default_policy()["paths"] == [], "built-in path map must be empty")

    # Synthetic policy exercises the handle mechanism with a fake CLI.
    policy = json.loads(json.dumps(base))
    policy["commands"] = [
        {"match": "examplecli", "alias": "org-cli-1", "action": "sanitize", "description": "fixture cli"}
    ]
    policy["paths"] = [
        {"prefix": str(Path.home() / ".examplecli"), "alias": "org-config-1", "action": "opaque", "description": "fixture dir"}
    ]
    policy["patterns"].extend(_identity_name_patterns(policy))

    deny_command = classify_command("examplecli auth whoami", policy)
    expect(bool(deny_command) and deny_command["channel"] == "command", "registered command must be denied")
    expect(
        bool(deny_command) and deny_command.get("alias") == "org-cli-1" and "examplecli" not in deny_command["rewrite"],
        "deny rewrite must use the neutral handle without the real name",
    )
    expect(classify_command("git status --short", policy) is None, "git command must pass")
    path_match = classify_path(str(Path.home() / ".examplecli" / "config.toml"), policy)
    expect(bool(path_match) and path_match["action"] == "opaque", "identity path must be denied opaque")
    expect(classify_path(str(Path.cwd() / "main.py"), policy) is None, "repo path must pass")
    expect(resolve_command_alias("org-cli-1", policy) == "examplecli", "handle must resolve to the real command")
    expect(resolve_command_alias("missing", policy) is None, "unknown handle must not resolve")

    opaque_result = _redact(
        "token eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.signaturepart12",
        base,
    )
    expect(opaque_result["level"] == "opaque", "JWT must escalate to opaque")
    expect("eyJ" not in json.dumps(opaque_result), "raw JWT must not appear in opaque result")

    sanitized = _redact("contact me at user@example.com", base)
    expect(sanitized["level"] == "sanitize", "email must sanitize")
    expect("user@example.com" not in sanitized["text"], "raw email must be replaced")

    help_like = _redact("usage: examplecli iam list; config in .examplecli/x", policy)
    expect(help_like["level"] == "sanitize", "self-named help text must sanitize")
    expect("examplecli" not in help_like["text"], "help must not echo the real command basename")
    expect(".examplecli" not in help_like["text"], "help must not echo the real config dir name")
    expect("org-cli-1" in help_like["text"], "help should map the name to its neutral handle")

    gate_payload = {
        "hook_event_name": CLAUDE_EVENT,
        "tool_name": "Bash",
        "tool_input": {"command": "examplecli iam list"},
    }
    expect(classify_payload(gate_payload, policy) is not None, "gate must classify Bash payload")
    gate_payload["tool_name"] = "shell"
    expect(classify_payload(gate_payload, policy) is not None, "gate must classify Codex shell payload")
    gate_payload.update(
        {"tool_name": "Read", "tool_input": {"file_path": str(Path.home() / ".examplecli" / "config")}}
    )
    expect(classify_payload(gate_payload, policy) is not None, "gate must classify Read payload")

    if failures:
        print("[imo veil] selftest failed", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("[imo veil] selftest ok")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="imo veil", description="Identity black box for marked CLIs and files.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("gate", help="PreToolUse hook entrypoint (stdin JSON)")

    run = subparsers.add_parser("run", help="Execute a registered command by handle, or a generic command, behind the veil")
    run.add_argument("--task", help="Neutral handle from `veil status`; the real command stays local")
    run.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    run.add_argument("argv", nargs=argparse.REMAINDER, help="Arguments after -- for the task, or a generic command")

    read_parser = subparsers.add_parser("read", help="Read a registered path by handle, or a generic file, behind the veil")
    read_parser.add_argument("--task", help="Neutral path handle from `veil status`")
    read_parser.add_argument("--rel", help="Relative path inside a handled directory")
    read_parser.add_argument("path", nargs="?", help="Generic, non-registered file path")

    check = subparsers.add_parser("check", help="Classify a command or path without executing")
    target = check.add_mutually_exclusive_group(required=True)
    target.add_argument("--command", dest="command_text")
    target.add_argument("--path", dest="target_path")

    status = subparsers.add_parser("status", help="Show neutral handles, policy, and host registration state")
    status.add_argument("--json", action="store_true")
    status.add_argument("--reveal", action="store_true", help="Human only: also print real command names and path prefixes")

    policy_parser = subparsers.add_parser("policy", help="Inspect or initialize the user policy")
    policy_parser.add_argument("policy_action", choices=("path", "init", "show"))

    subparsers.add_parser("context", help="Model-safe capability announcement (neutral handles only)")
    subparsers.add_parser("register", help="Interactive local registration; run in your own terminal")
    subparsers.add_parser("selftest", help="Run built-in fixture checks")

    for name, handler in (("install", _install), ("uninstall", _uninstall)):
        sub = subparsers.add_parser(name)
        sub.add_argument("--apply", action="store_true", help="Write changes; omit for dry run")
        sub.add_argument("--force", action="store_true", help="Reserved for unmanaged-conflict overrides")
        sub.add_argument("--host", choices=("both", "claude", "codex"), default="both")
        sub.add_argument("--gate-only", action="store_true", help="Install only the PreToolUse gate, no session announcement")
        sub.add_argument("--claude-home", help="Override Claude settings directory")
        sub.add_argument("--codex-root", help="Override Codex home directory")
        sub.set_defaults(func=handler)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "gate":
        return _gate()
    if args.command == "context":
        return _context()
    if args.command == "register":
        return _register()
    if args.command == "selftest":
        return _selftest()
    if args.command == "run":
        extra = list(args.argv)
        if extra and extra[0] == "--":
            extra = extra[1:]
        policy, _warnings = merged_policy()
        return _run_veiled(policy, args.timeout, task=args.task, raw_argv=extra)
    if args.command == "read":
        policy, _warnings = merged_policy()
        return _read_veiled(policy, task=args.task, target=args.path, relative=args.rel)
    if args.command == "check":
        return _check(args)
    if args.command == "status":
        return _status(bool(args.json), bool(args.reveal))
    if args.command == "policy":
        return _policy_command(args)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
