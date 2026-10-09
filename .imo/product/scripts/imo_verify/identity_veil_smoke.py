from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from .runner import ROOT, python_env


JWT = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.signaturepart12"


def _run(args, *, env=None, stdin=None):
    return subprocess.run(
        ["./imo", "veil", *args],
        cwd=ROOT,
        env=env,
        input=stdin,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _gate(hook_path: Path, payload: dict, *, env) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(hook_path)],
        cwd=ROOT,
        env=env,
        input=json.dumps(payload),
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _fail(message: str, result: subprocess.CompletedProcess | None = None) -> bool:
    print(f"[imo verify] failed: {message}", file=sys.stderr)
    if result is not None:
        if result.stdout:
            print(result.stdout, file=sys.stderr)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
    return False


def run_identity_veil_smoke() -> bool:
    print("[imo verify] identity veil behavior")
    with tempfile.TemporaryDirectory(prefix="imo-veil-") as raw:
        base = Path(raw)
        bindir = base / "bin"
        identity_dir = base / "identity" / ".exampleorg"
        global_root = base / "global"
        bindir.mkdir(parents=True)
        identity_dir.mkdir(parents=True)
        (global_root / "runtime" / "identity-veil").mkdir(parents=True)

        fake_cli = bindir / "examplecli"
        fake_cli.write_text(
            "#!/usr/bin/env bash\n"
            f'echo "mail user@example.com token {JWT}"\n',
            encoding="utf-8",
        )
        fake_cli.chmod(0o755)
        (identity_dir / "config").write_text("jwt " + JWT + "\n", encoding="utf-8")

        policy = {
            "schema_version": 1,
            "enabled": True,
            "commands": [
                {"match": "examplecli", "alias": "org-cli-1", "description": "fixture org CLI", "action": "sanitize"}
            ],
            "paths": [
                {"prefix": str(identity_dir), "alias": "org-config-1", "description": "fixture config", "action": "opaque"}
            ],
            "patterns": [],
        }
        (global_root / "runtime" / "identity-veil" / "policy.json").write_text(
            json.dumps(policy), encoding="utf-8"
        )

        env = python_env()
        env["IMO_GLOBAL_ROOT"] = str(global_root)
        env["IMO_DISABLE_EVENTS"] = "1"
        env["PATH"] = str(bindir) + os.pathsep + env.get("PATH", "")

        selftest = _run(["selftest"], env=env)
        if selftest.returncode != 0 or "selftest ok" not in selftest.stdout:
            return _fail("veil selftest", selftest)

        deny = _run(["check", "--command", "examplecli whoami"], env=env)
        if deny.returncode != 0 or json.loads(deny.stdout)["verdict"] != "deny":
            return _fail("veil check deny", deny)
        allow = _run(["check", "--command", "git log -1"], env=env)
        if allow.returncode != 0 or json.loads(allow.stdout)["verdict"] != "allow":
            return _fail("veil check allow", allow)

        blocked = _run(
            ["gate"], env=env,
            stdin=json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "examplecli x"}}),
        )
        if blocked.returncode != 2 or "veil run --task" not in blocked.stderr or "examplecli x" in blocked.stderr:
            return _fail("gate deny must redirect to handle without restating arguments", blocked)
        blocked_read = _run(
            ["gate"], env=env,
            stdin=json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": {"file_path": str(identity_dir / "config")}}),
        )
        if blocked_read.returncode != 2 or "veil read --task" not in blocked_read.stderr:
            return _fail("gate read deny must redirect to path handle", blocked_read)
        passed = _run(
            ["gate"], env=env,
            stdin=json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "ls -la"}}),
        )
        if passed.returncode != 0:
            return _fail("gate allow", passed)
        if _run(["gate"], env=env, stdin="not-json").returncode != 0:
            return _fail("gate must fail open on bad payload")

        task_run = _run(["run", "--task", "org-cli-1"], env=env)
        if task_run.returncode != 0:
            return _fail("run by handle", task_run)
        envelope = json.loads(task_run.stdout)
        if envelope["level"] != "opaque" or not envelope["stdout"].get("hidden") or envelope.get("task") != "org-cli-1":
            return _fail("handle run envelope must be opaque and tagged by handle")
        if "examplecli" in task_run.stdout or JWT[:12] in task_run.stdout:
            return _fail("handle run envelope leaks real name or raw bytes")

        refused = _run(["run", "--", "examplecli", "x"], env=env)
        if refused.returncode != 64 or "handle" not in refused.stderr:
            return _fail("raw run of a registered command must be refused", refused)

        clear_run = _run(["run", "--", "echo", "plain-output"], env=env)
        clear_envelope = json.loads(clear_run.stdout)
        if clear_envelope["level"] != "clear" or "plain-output" not in clear_envelope["stdout"]["text"]:
            return _fail("generic command must run clear", clear_run)

        handled_read = _run(["read", "--task", "org-config-1", "--rel", "config"], env=env)
        read_envelope = json.loads(handled_read.stdout)
        if read_envelope["level"] != "opaque" or read_envelope.get("task") != "org-config-1":
            return _fail("handled read must be opaque and tagged", handled_read)
        if JWT[:12] in handled_read.stdout:
            return _fail("handled read leaks raw bytes")

        refused_read = _run(["read", str(identity_dir / "config")], env=env)
        if refused_read.returncode != 64 or "handle" not in refused_read.stderr:
            return _fail("raw read of a registered path must be refused", refused_read)

        status = _run(["status", "--json"], env=env)
        status_doc = status.stdout
        if "examplecli" in status_doc or ".exampleorg" in status_doc:
            return _fail("default status must not reveal real command or path")
        status_json = json.loads(status_doc)
        handles = {entry["task"] for entry in status_json["commands"]} | {
            entry["task"] for entry in status_json["paths"]
        }
        if {"org-cli-1", "org-config-1"} - handles:
            return _fail("status must list the neutral handles")

        claude_home = base / "claude"
        codex_home = base / "codex"
        claude_home.mkdir()
        codex_home.mkdir()
        third_party = {
            "hooks": {"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "third-party"}]}]}
        }
        claude_settings = claude_home / "settings.json"
        codex_hooks = codex_home / "hooks.json"
        claude_settings.write_text(json.dumps(third_party), encoding="utf-8")
        codex_hooks.write_text(json.dumps(third_party), encoding="utf-8")

        dry = _run(
            ["install", "--host", "both", "--claude-home", str(claude_home), "--codex-root", str(codex_home)],
            env=env,
        )
        if dry.returncode != 0:
            return _fail("install dry run", dry)
        if (global_root / "hooks" / "veil-gate.sh").exists():
            return _fail("dry run must not project the gate hook")
        if (global_root / "hooks" / "veil-context.sh").exists():
            return _fail("dry run must not project the context hook")

        applied = _run(
            [
                "install", "--apply", "--host", "both",
                "--claude-home", str(claude_home), "--codex-root", str(codex_home),
            ],
            env=env,
        )
        if applied.returncode != 0:
            return _fail("install apply", applied)

        gate_hook = global_root / "hooks" / "veil-gate.sh"
        context_hook = global_root / "hooks" / "veil-context.sh"
        if not gate_hook.is_file() or not context_hook.is_file():
            return _fail("gate and context hooks must both be projected")
        for label, path in (("claude", claude_settings), ("codex", codex_hooks)):
            doc = json.loads(path.read_text(encoding="utf-8"))["hooks"]
            gate_commands = [hook["command"] for entry in doc["PreToolUse"] for hook in entry["hooks"]]
            context_commands = [
                hook["command"]
                for entry in doc.get("SessionStart", [])
                for hook in entry["hooks"]
            ]
            if "third-party" not in gate_commands:
                return _fail(f"install dropped third-party {label} hook")
            if not any(str(gate_hook) in command for command in gate_commands):
                return _fail(f"gate not registered for {label}")
            if not any(str(context_hook) in command for command in context_commands):
                return _fail(f"context announcement not registered for {label}")

        announced = subprocess.run(
            ["bash", str(context_hook)], cwd=ROOT, env=env, check=False,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        if announced.returncode != 0 or "imo-veil" not in announced.stdout:
            return _fail("context hook must emit the model-safe announcement", announced)
        if "examplecli" in announced.stdout or ".exampleorg" in announced.stdout:
            return _fail("context announcement leaks a real command or path")

        live = _gate(
            gate_hook,
            {"hook_event_name": "PreToolUse", "tool_name": "shell", "tool_input": {"command": "examplecli y"}},
            env=env,
        )
        if live.returncode != 2:
            return _fail("installed gate hook does not block the registered command")

        post_status = _run(["status", "--json"], env=env)
        hosts = json.loads(post_status.stdout)["hosts"]
        if hosts.get("claude") != "present" or hosts.get("codex") != "present":
            return _fail(f"post-install status must be present, got {hosts}")

        removed = _run(
            [
                "uninstall", "--apply", "--host", "both",
                "--claude-home", str(claude_home), "--codex-root", str(codex_home),
            ],
            env=env,
        )
        if removed.returncode != 0:
            return _fail("uninstall", removed)
        for label, path in (("claude", claude_settings), ("codex", codex_hooks)):
            doc = json.loads(path.read_text(encoding="utf-8"))["hooks"]
            gate_commands = [hook["command"] for entry in doc["PreToolUse"] for hook in entry["hooks"]]
            context_commands = [
                hook["command"] for entry in doc.get("SessionStart", []) for hook in entry["hooks"]
            ]
            if "third-party" not in gate_commands:
                return _fail(f"uninstall dropped third-party {label} hook")
            if any(str(gate_hook) in command for command in gate_commands):
                return _fail(f"gate registration remains for {label}")
            if any(str(context_hook) in command for command in context_commands):
                return _fail(f"context registration remains for {label}")
        if gate_hook.exists() or context_hook.exists():
            return _fail("veil hook files remain after uninstall")

    print("[imo verify] ok: identity veil behavior")
    return True
