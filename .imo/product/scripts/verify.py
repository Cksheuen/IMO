#!/usr/bin/env python3
"""Run the repo-local IMO verification suite."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[3]
PYCACHE_PREFIX = Path(os.environ.get("PYTHONPYCACHEPREFIX", "/private/tmp/cc-codex-framework-pycache"))


def _run(label: str, command: list[str], *, env: dict[str, str] | None = None) -> bool:
    print(f"[imo verify] {label}")
    result = subprocess.run(command, cwd=ROOT, env=env, check=False)
    if result.returncode == 0:
        print(f"[imo verify] ok: {label}")
        return True
    print(f"[imo verify] failed ({result.returncode}): {label}", file=sys.stderr)
    return False


def _python_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONPYCACHEPREFIX"] = str(PYCACHE_PREFIX)
    return env


def _run_learning_signal_smoke() -> bool:
    print("[imo verify] learning raw signal behavior")
    runtime_dir = ROOT / ".imo/.runtime/learning"
    signals_path = runtime_dir / "signals.jsonl"
    backup_dir: Path | None = None

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-learning-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "learning", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        list_missing = subprocess.run(
            ["./imo", "learning", "signal", "list"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if list_missing.returncode != 0 or "no raw signals found" not in list_missing.stdout:
            print("[imo verify] failed: learning signal missing-state list", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: signal list created runtime state", file=sys.stderr)
            return False

        add = subprocess.run(
            [
                "./imo",
                "learning",
                "signal",
                "add",
                "--summary",
                "verify raw signal smoke",
                "--source-agent",
                "imo-verify",
                "--scope",
                "project",
                "--privacy",
                "project_private",
                "--confidence",
                "low",
                "--evidence-ref",
                "verify:learning-signal-smoke",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if add.returncode != 0 or not signals_path.exists():
            print("[imo verify] failed: learning signal add", file=sys.stderr)
            if add.stderr:
                print(add.stderr, file=sys.stderr)
            return False

        raw_lines = signals_path.read_text(encoding="utf-8").strip().splitlines()
        if len(raw_lines) != 1:
            print("[imo verify] failed: expected one raw signal line", file=sys.stderr)
            return False
        signal = __import__("json").loads(raw_lines[0])
        expected = {
            "source_agent": "imo-verify",
            "scope": "project",
            "privacy": "project_private",
            "confidence": "low",
            "summary": "verify raw signal smoke",
            "evidence_ref": "verify:learning-signal-smoke",
        }
        for key, value in expected.items():
            if signal.get(key) != value:
                print(f"[imo verify] failed: signal {key} mismatch", file=sys.stderr)
                return False

        listed = subprocess.run(
            ["./imo", "learning", "signal", "list"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if listed.returncode != 0 or "verify raw signal smoke" not in listed.stdout:
            print("[imo verify] failed: learning signal list after add", file=sys.stderr)
            return False

        invalid = subprocess.run(
            ["./imo", "learning", "signal", "add", "--summary", "bad", "--scope", "planet"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if invalid.returncode == 0 or "--scope must be one of" not in invalid.stderr:
            print("[imo verify] failed: invalid signal scope was not rejected", file=sys.stderr)
            return False

        print("[imo verify] ok: learning raw signal behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning raw signal behavior: {exc}", file=sys.stderr)
        return False
    finally:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)


def _run_learning_candidate_smoke() -> bool:
    print("[imo verify] learning candidate behavior")
    runtime_dir = ROOT / ".imo/.runtime/learning"
    backup_dir: Path | None = None

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-learning-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "learning", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        for summary in ("candidate smoke", "candidate smoke"):
            add = subprocess.run(
                [
                    "./imo",
                    "learning",
                    "signal",
                    "add",
                    "--summary",
                    summary,
                    "--source-agent",
                    "imo-verify",
                    "--scope",
                    "project",
                    "--privacy",
                    "project_private",
                    "--confidence",
                    "medium",
                ],
                cwd=ROOT,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            if add.returncode != 0:
                print("[imo verify] failed: setup signal for candidate smoke", file=sys.stderr)
                return False

        build = subprocess.run(
            ["./imo", "learning", "candidate", "build"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if build.returncode != 0 or "1 created" not in build.stdout:
            print("[imo verify] failed: candidate build", file=sys.stderr)
            return False

        listed = subprocess.run(
            ["./imo", "learning", "candidate", "list"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if listed.returncode != 0 or "candidate smoke" not in listed.stdout:
            print("[imo verify] failed: candidate list", file=sys.stderr)
            return False

        candidate_lines = [line for line in listed.stdout.splitlines() if line.startswith("candidate-")]
        if len(candidate_lines) != 1:
            print("[imo verify] failed: expected one candidate line", file=sys.stderr)
            return False
        candidate_id = candidate_lines[0].split("\t", 1)[0]

        inspected = subprocess.run(
            ["./imo", "learning", "candidate", "inspect", candidate_id],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if inspected.returncode != 0 or '"source_signal_refs"' not in inspected.stdout:
            print("[imo verify] failed: candidate inspect", file=sys.stderr)
            return False

        rejected = subprocess.run(
            ["./imo", "learning", "candidate", "reject", candidate_id, "--reason", "verify rejection"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if rejected.returncode != 0:
            print("[imo verify] failed: candidate reject", file=sys.stderr)
            return False

        rejected_inspect = subprocess.run(
            ["./imo", "learning", "candidate", "inspect", candidate_id],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if rejected_inspect.returncode != 0 or '"status": "rejected"' not in rejected_inspect.stdout:
            print("[imo verify] failed: rejected candidate status", file=sys.stderr)
            return False

        digest_path = runtime_dir / "digest.json"
        if digest_path.exists():
            print("[imo verify] failed: candidate commands mutated active digest", file=sys.stderr)
            return False

        print("[imo verify] ok: learning candidate behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning candidate behavior: {exc}", file=sys.stderr)
        return False
    finally:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)


def _run_learning_digest_smoke() -> bool:
    print("[imo verify] learning digest controls")
    runtime_dir = ROOT / ".imo/.runtime/learning"
    backup_dir: Path | None = None

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-learning-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "learning", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        add = subprocess.run(
            ["./imo", "learning", "signal", "add", "--summary", "digest smoke", "--source-agent", "imo-verify"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if add.returncode != 0:
            print("[imo verify] failed: setup signal for digest smoke", file=sys.stderr)
            return False

        build = subprocess.run(
            ["./imo", "learning", "candidate", "build"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if build.returncode != 0:
            print("[imo verify] failed: setup candidate for digest smoke", file=sys.stderr)
            return False

        listed = subprocess.run(
            ["./imo", "learning", "candidate", "list"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        candidate_lines = [line for line in listed.stdout.splitlines() if line.startswith("candidate-")]
        if len(candidate_lines) != 1:
            print("[imo verify] failed: expected one digest smoke candidate", file=sys.stderr)
            return False
        candidate_id = candidate_lines[0].split("\t", 1)[0]

        refused = subprocess.run(
            ["./imo", "learning", "digest", "promote", candidate_id, "--rollback-id", "rollback-only"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if refused.returncode == 0 or "--review-ref is required" not in refused.stderr:
            print("[imo verify] failed: digest promote allowed missing review", file=sys.stderr)
            return False

        promoted = subprocess.run(
            [
                "./imo",
                "learning",
                "digest",
                "promote",
                candidate_id,
                "--review-ref",
                "verify:review",
                "--rollback-id",
                "verify:rollback",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if promoted.returncode != 0:
            print("[imo verify] failed: digest promote", file=sys.stderr)
            return False
        digest_id = promoted.stdout.strip()

        digest_list = subprocess.run(
            ["./imo", "learning", "list"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if digest_list.returncode != 0 or "digest smoke" not in digest_list.stdout:
            print("[imo verify] failed: digest list after promote", file=sys.stderr)
            return False

        disabled = subprocess.run(
            ["./imo", "learning", "digest", "disable", digest_id, "--reason", "verify disable"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if disabled.returncode != 0:
            print("[imo verify] failed: digest disable", file=sys.stderr)
            return False

        reset = subprocess.run(
            ["./imo", "learning", "digest", "reset", "--scope", "project"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if reset.returncode != 0 or "1 project item" not in reset.stdout:
            print("[imo verify] failed: digest reset", file=sys.stderr)
            return False

        print("[imo verify] ok: learning digest controls")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning digest controls: {exc}", file=sys.stderr)
        return False
    finally:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)


def _run_learning_context_smoke() -> bool:
    print("[imo verify] learning context injection")
    runtime_dir = ROOT / ".imo/.runtime/learning"
    digest_path = runtime_dir / "digest.json"
    backup_dir: Path | None = None

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-learning-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "learning", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        runtime_dir.mkdir(parents=True, exist_ok=True)
        digest_path.write_text(
            """{
  "items": [
    {
      "digest_version": "1",
      "id": "digest-active",
      "last_updated": "2026-05-21T00:00:00Z",
      "priority": "high",
      "rollback_id": "verify:rollback",
      "scope": "project",
      "source_candidates": ["candidate-active"],
      "status": "active",
      "summary": "Prefer reviewed digest behavior only after project rules"
    },
    {
      "digest_version": "1",
      "id": "digest-disabled",
      "last_updated": "2026-05-21T00:00:00Z",
      "priority": "normal",
      "rollback_id": "verify:rollback-disabled",
      "scope": "project",
      "source_candidates": ["candidate-disabled"],
      "status": "disabled",
      "summary": "This disabled digest must not be injected"
    }
  ]
}
""",
            encoding="utf-8",
        )

        context = subprocess.run(
            ["./imo", "codex", "context", "--empty"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if context.returncode != 0:
            print("[imo verify] failed: codex context with digest", file=sys.stderr)
            return False
        if "Prefer reviewed digest behavior only after project rules" not in context.stdout:
            print("[imo verify] failed: active digest missing from context", file=sys.stderr)
            return False
        if "This disabled digest must not be injected" in context.stdout:
            print("[imo verify] failed: disabled digest injected into context", file=sys.stderr)
            return False
        if "current user instruction > project rules > active digest" not in context.stdout:
            print("[imo verify] failed: digest priority guard missing", file=sys.stderr)
            return False

        print("[imo verify] ok: learning context injection")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning context injection: {exc}", file=sys.stderr)
        return False
    finally:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)


def _run_project_profile_smoke() -> bool:
    print("[imo verify] project profile behavior")
    runtime_dir = ROOT / ".imo/.runtime/project-profile"
    backup_dir: Path | None = None

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-profile-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "project-profile", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        status_missing = subprocess.run(
            ["./imo", "profile", "status"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if status_missing.returncode != 0 or "status\tmissing" not in status_missing.stdout:
            print("[imo verify] failed: profile missing-state status", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: profile status created runtime state", file=sys.stderr)
            return False

        inspect_missing = subprocess.run(
            ["./imo", "profile", "inspect"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if inspect_missing.returncode != 0 or "no profile found" not in inspect_missing.stdout:
            print("[imo verify] failed: profile missing-state inspect", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: profile inspect created runtime state", file=sys.stderr)
            return False

        refreshed = subprocess.run(
            ["./imo", "profile", "refresh"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if refreshed.returncode != 0:
            print("[imo verify] failed: profile refresh", file=sys.stderr)
            if refreshed.stderr:
                print(refreshed.stderr, file=sys.stderr)
            return False
        for expected in ("current.json", "summary.md", "manifest.json"):
            if not (runtime_dir / expected).is_file():
                print(f"[imo verify] failed: profile refresh missing {expected}", file=sys.stderr)
                return False

        status_current = subprocess.run(
            ["./imo", "profile", "status"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if status_current.returncode != 0 or "status\tcurrent" not in status_current.stdout:
            print("[imo verify] failed: profile current status", file=sys.stderr)
            return False

        inspected = subprocess.run(
            ["./imo", "profile", "inspect"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if inspected.returncode != 0 or "IMO Project Profile" not in inspected.stdout:
            print("[imo verify] failed: profile inspect after refresh", file=sys.stderr)
            return False

        context = subprocess.run(
            ["./imo", "codex", "context", "--empty"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if context.returncode != 0:
            print("[imo verify] failed: codex context with profile", file=sys.stderr)
            return False
        if "Project profile:" not in context.stdout or "profile is guidance" not in context.stdout:
            print("[imo verify] failed: profile summary missing from context", file=sys.stderr)
            return False

        cleared = subprocess.run(
            ["./imo", "profile", "clear"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if cleared.returncode != 0 or runtime_dir.exists():
            print("[imo verify] failed: profile clear", file=sys.stderr)
            return False

        print("[imo verify] ok: project profile behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: project profile behavior: {exc}", file=sys.stderr)
        return False
    finally:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_profile = backup_dir / "project-profile"
            if backup_profile.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_profile, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)


def main() -> int:
    python_env = _python_env()
    checks = [
        (
            "host ownership audit",
            ["bash", "scripts/imo.sh", "audit", "all"],
            None,
        ),
        (
            "root entry help",
            ["bash", "scripts/imo.sh", "--help"],
            None,
        ),
        (
            "direct root entry help",
            ["./imo", "--help"],
            None,
        ),
        (
            "direct root entry syntax",
            ["bash", "-n", "imo"],
            None,
        ),
        (
            "shell wrapper syntax",
            ["bash", "-n", "scripts/imo.sh"],
            None,
        ),
        (
            "canonical shell syntax",
            ["bash", "-n", ".imo/product/scripts/imo.sh"],
            None,
        ),
        (
            "module metadata contract",
            [sys.executable, ".imo/product/scripts/check_module_metadata.py"],
            python_env,
        ),
        (
            "rule contracts",
            [sys.executable, ".imo/product/scripts/check_rule_contracts.py"],
            python_env,
        ),
        (
            "learning contract policy",
            [sys.executable, ".imo/product/scripts/check_learning_contracts.py"],
            python_env,
        ),
        (
            "project profile contracts",
            [sys.executable, ".imo/product/scripts/check_project_profile_contracts.py"],
            python_env,
        ),
        (
            "provider contract registry",
            [sys.executable, ".imo/product/scripts/check_provider_contracts.py"],
            python_env,
        ),
        (
            "root compatibility surfaces",
            [sys.executable, ".imo/product/scripts/check_root_surfaces.py"],
            python_env,
        ),
        (
            "learning read-only list",
            ["bash", "scripts/imo.sh", "learning", "list"],
            None,
        ),
        (
            "codex context hook",
            ["./imo", "codex", "context", "--empty"],
            None,
        ),
        (
            "python script compile",
            [
                sys.executable,
                "-m",
                "py_compile",
                ".imo/product/scripts/audit_managed_ownership.py",
                ".imo/product/scripts/audit_runtime_links_core.py",
                ".imo/product/scripts/codex_context.py",
                ".imo/product/scripts/check_learning_contracts.py",
                ".imo/product/scripts/check-langchain-runtime-deps.py",
                ".imo/product/scripts/check_module_metadata.py",
                ".imo/product/scripts/check_project_profile_contracts.py",
                ".imo/product/scripts/check_provider_contracts.py",
                ".imo/product/scripts/check_rule_contracts.py",
                ".imo/product/scripts/check_root_surfaces.py",
                ".imo/product/scripts/learning.py",
                ".imo/product/scripts/project_profile.py",
                ".imo/product/scripts/task-audit.py",
                ".imo/product/scripts/verify.py",
                "scripts/audit_runtime_links_core.py",
                "scripts/check-langchain-runtime-deps.py",
                "scripts/task-audit.py",
            ],
            python_env,
        ),
        (
            "runtime-link compatibility import",
            [
                sys.executable,
                "-c",
                "import scripts.audit_runtime_links_core as m; assert callable(m.summarize)",
            ],
            python_env,
        ),
        (
            "shared runtime compatibility import",
            [
                sys.executable,
                "-c",
                "import skills.migrated.shared_runtime as s; assert hasattr(s, 'build_delta_context')",
            ],
            python_env,
        ),
    ]

    failures = 0
    for label, command, env in checks:
        if not _run(label, command, env=env):
            failures += 1
    if not _run_learning_signal_smoke():
        failures += 1
    if not _run_learning_candidate_smoke():
        failures += 1
    if not _run_learning_digest_smoke():
        failures += 1
    if not _run_learning_context_smoke():
        failures += 1
    if not _run_project_profile_smoke():
        failures += 1

    if failures:
        print(f"[imo verify] {failures} check(s) failed", file=sys.stderr)
        return 1
    print("[imo verify] all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
