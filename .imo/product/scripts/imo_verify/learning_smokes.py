from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT


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


def _run_learning_deferred_review_smoke() -> bool:
    print("[imo verify] learning deferred review behavior")
    learning_dir = ROOT / ".imo/.runtime/learning"
    session_dir = ROOT / ".imo/.runtime/session"
    candidates_path = learning_dir / "candidates.jsonl"
    digest_path = learning_dir / "digest.json"
    backup_dir: Path | None = None

    try:
        if learning_dir.exists() or session_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-deferred-review-backup-"))
            if learning_dir.exists():
                shutil.copytree(learning_dir, backup_dir / "learning", dirs_exist_ok=True)
                shutil.rmtree(learning_dir)
            if session_dir.exists():
                shutil.copytree(session_dir, backup_dir / "session", dirs_exist_ok=True)
                shutil.rmtree(session_dir)

        status_missing = subprocess.run(
            ["./imo", "learning", "activity", "status"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if status_missing.returncode != 0 or "no session activity found" not in status_missing.stdout:
            print("[imo verify] failed: activity missing-state status", file=sys.stderr)
            return False
        if session_dir.exists():
            print("[imo verify] failed: activity status created runtime state", file=sys.stderr)
            return False

        skipped_missing = subprocess.run(
            ["./imo", "learning", "review", "prepare"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if skipped_missing.returncode != 0 or "review prepare skipped" not in skipped_missing.stdout:
            print("[imo verify] failed: missing activity did not skip review prepare", file=sys.stderr)
            return False

        add = subprocess.run(
            [
                "./imo",
                "learning",
                "signal",
                "add",
                "--summary",
                "deferred review smoke",
                "--source-agent",
                "imo-verify",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if add.returncode != 0:
            print("[imo verify] failed: setup signal for deferred review smoke", file=sys.stderr)
            return False

        active = subprocess.run(
            [
                "./imo",
                "learning",
                "activity",
                "mark",
                "--state",
                "active",
                "--session-id",
                "verify-session",
                "--running-tools",
                "1",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if active.returncode != 0:
            print("[imo verify] failed: activity mark active", file=sys.stderr)
            return False

        skipped_active = subprocess.run(
            ["./imo", "learning", "review", "prepare"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if skipped_active.returncode != 0 or "activity state is active" not in skipped_active.stdout:
            print("[imo verify] failed: active activity did not skip review prepare", file=sys.stderr)
            return False
        if candidates_path.exists():
            print("[imo verify] failed: skipped review prepare wrote candidates", file=sys.stderr)
            return False

        forced = subprocess.run(
            ["./imo", "learning", "review", "prepare", "--force"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if forced.returncode != 0 or "1 created" not in forced.stdout:
            print("[imo verify] failed: forced review prepare", file=sys.stderr)
            return False
        if digest_path.exists():
            print("[imo verify] failed: review prepare mutated active digest", file=sys.stderr)
            return False

        inbox = subprocess.run(
            ["./imo", "learning", "review", "inbox"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if inbox.returncode != 0 or "deferred review smoke" not in inbox.stdout:
            print("[imo verify] failed: review inbox missing candidate", file=sys.stderr)
            return False
        candidate_lines = [line for line in inbox.stdout.splitlines() if line.startswith("candidate-")]
        if len(candidate_lines) != 1:
            print("[imo verify] failed: expected one review inbox candidate", file=sys.stderr)
            return False
        candidate_id = candidate_lines[0].split("\t", 1)[0]

        refused = subprocess.run(
            ["./imo", "learning", "review", "approve", candidate_id, "--rollback-id", "verify:rollback"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if refused.returncode == 0 or "--review-ref is required" not in refused.stderr:
            print("[imo verify] failed: review approve allowed missing review", file=sys.stderr)
            return False

        approved = subprocess.run(
            [
                "./imo",
                "learning",
                "review",
                "approve",
                candidate_id,
                "--review-ref",
                "verify:deferred-review",
                "--rollback-id",
                "verify:deferred-rollback",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if approved.returncode != 0 or not digest_path.exists():
            print("[imo verify] failed: review approve", file=sys.stderr)
            return False

        inbox_after_approve = subprocess.run(
            ["./imo", "learning", "review", "inbox"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if (
            inbox_after_approve.returncode != 0
            or "review inbox is empty" not in inbox_after_approve.stdout
        ):
            print("[imo verify] failed: approved candidate remained in inbox", file=sys.stderr)
            return False

        add_post_turn = subprocess.run(
            [
                "./imo",
                "learning",
                "signal",
                "add",
                "--summary",
                "post-turn review smoke",
                "--source-agent",
                "imo-verify",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if add_post_turn.returncode != 0:
            print("[imo verify] failed: setup signal for post-turn review smoke", file=sys.stderr)
            return False

        post_turn = subprocess.run(
            [
                "./imo",
                "learning",
                "activity",
                "mark",
                "--state",
                "post_turn",
                "--session-id",
                "verify-session",
                "--running-tools",
                "0",
                "--running-agents",
                "0",
                "--pending-approval",
                "false",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if post_turn.returncode != 0:
            print("[imo verify] failed: activity mark post_turn", file=sys.stderr)
            return False

        prepared_post_turn = subprocess.run(
            ["./imo", "learning", "review", "prepare"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if prepared_post_turn.returncode != 0 or "1 created" not in prepared_post_turn.stdout:
            print("[imo verify] failed: post-turn review prepare", file=sys.stderr)
            return False

        inbox_post_turn = subprocess.run(
            ["./imo", "learning", "review", "inbox"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if inbox_post_turn.returncode != 0 or "post-turn review smoke" not in inbox_post_turn.stdout:
            print("[imo verify] failed: post-turn candidate missing from inbox", file=sys.stderr)
            return False

        print("[imo verify] ok: learning deferred review behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning deferred review behavior: {exc}", file=sys.stderr)
        return False
    finally:
        if learning_dir.exists():
            shutil.rmtree(learning_dir)
        if session_dir.exists():
            shutil.rmtree(session_dir)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                learning_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, learning_dir, dirs_exist_ok=True)
            backup_session = backup_dir / "session"
            if backup_session.exists():
                session_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_session, session_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)


def _run_learning_telemetry_smoke() -> bool:
    print("[imo verify] learning telemetry metrics")
    learning_dir = ROOT / ".imo/.runtime/learning"
    session_dir = ROOT / ".imo/.runtime/session"
    candidates_path = learning_dir / "candidates.jsonl"
    digest_path = learning_dir / "digest.json"
    backup_dir: Path | None = None

    try:
        if learning_dir.exists() or session_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-telemetry-backup-"))
            if learning_dir.exists():
                shutil.copytree(learning_dir, backup_dir / "learning", dirs_exist_ok=True)
                shutil.rmtree(learning_dir)
            if session_dir.exists():
                shutil.copytree(session_dir, backup_dir / "session", dirs_exist_ok=True)
                shutil.rmtree(session_dir)

        summary_missing = subprocess.run(
            ["./imo", "learning", "metrics", "summary"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if summary_missing.returncode != 0 or "total_events\t0" not in summary_missing.stdout:
            print("[imo verify] failed: metrics missing-state summary", file=sys.stderr)
            return False
        if learning_dir.exists():
            print("[imo verify] failed: metrics summary created runtime state", file=sys.stderr)
            return False

        summary_json_missing = subprocess.run(
            ["./imo", "learning", "metrics", "summary", "--json"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if summary_json_missing.returncode != 0:
            print("[imo verify] failed: metrics missing-state json summary", file=sys.stderr)
            return False
        missing_payload = json.loads(summary_json_missing.stdout)
        if missing_payload.get("total_events") != 0:
            print("[imo verify] failed: metrics missing-state json count", file=sys.stderr)
            return False

        add = subprocess.run(
            [
                "./imo",
                "learning",
                "signal",
                "add",
                "--summary",
                "telemetry smoke",
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
            print("[imo verify] failed: setup signal for telemetry smoke", file=sys.stderr)
            return False
        events_path = learning_dir / "events.jsonl"
        if not events_path.exists():
            print("[imo verify] failed: signal event write", file=sys.stderr)
            return False
        event_payload = events_path.read_text(encoding="utf-8")
        if "telemetry smoke" in event_payload:
            print("[imo verify] failed: event log stored raw signal summary", file=sys.stderr)
            return False

        import importlib.util

        module_path = ROOT / ".imo/product/scripts/learning_events.py"
        spec = importlib.util.spec_from_file_location("imo_learning_events_verify", module_path)
        if spec is None or spec.loader is None:
            print("[imo verify] failed: could not load learning_events helper", file=sys.stderr)
            return False
        learning_events = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(learning_events)
        unknown_written = learning_events.write_event("unknown_event", "imo-verify")
        unsafe_written = learning_events.write_event(
            "prepare_skipped",
            "imo-verify",
            reason="x" * 160,
            raw_prompt="must-not-persist",
        )
        if unknown_written or not unsafe_written:
            print("[imo verify] failed: event helper validation", file=sys.stderr)
            return False
        event_payload = events_path.read_text(encoding="utf-8")
        if "must-not-persist" in event_payload or ("x" * 140) in event_payload:
            print("[imo verify] failed: event helper persisted unsafe fields", file=sys.stderr)
            return False

        active = subprocess.run(
            [
                "./imo",
                "learning",
                "activity",
                "mark",
                "--state",
                "active",
                "--session-id",
                "verify-session",
                "--running-tools",
                "1",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if active.returncode != 0:
            print("[imo verify] failed: activity mark for telemetry smoke", file=sys.stderr)
            return False

        skipped = subprocess.run(
            ["./imo", "learning", "review", "prepare"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if skipped.returncode != 0 or "activity state is active" not in skipped.stdout:
            print("[imo verify] failed: telemetry prepare skip event setup", file=sys.stderr)
            return False
        if candidates_path.exists():
            print("[imo verify] failed: skipped telemetry prepare wrote candidates", file=sys.stderr)
            return False

        prepared = subprocess.run(
            ["./imo", "learning", "review", "prepare", "--force"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if prepared.returncode != 0 or "1 created" not in prepared.stdout:
            print("[imo verify] failed: forced telemetry prepare", file=sys.stderr)
            return False
        if digest_path.exists():
            print("[imo verify] failed: telemetry prepare mutated digest", file=sys.stderr)
            return False

        inbox = subprocess.run(
            ["./imo", "learning", "review", "inbox"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if inbox.returncode != 0 or "telemetry smoke" not in inbox.stdout:
            print("[imo verify] failed: telemetry inbox", file=sys.stderr)
            return False
        candidate_lines = [line for line in inbox.stdout.splitlines() if line.startswith("candidate-")]
        if len(candidate_lines) != 1:
            print("[imo verify] failed: expected one telemetry candidate", file=sys.stderr)
            return False
        candidate_id = candidate_lines[0].split("\t", 1)[0]

        approved = subprocess.run(
            [
                "./imo",
                "learning",
                "review",
                "approve",
                candidate_id,
                "--review-ref",
                "verify:telemetry",
                "--rollback-id",
                "verify:telemetry-rollback",
            ],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if approved.returncode != 0 or not digest_path.exists():
            print("[imo verify] failed: telemetry review approve", file=sys.stderr)
            return False
        digest_id = approved.stdout.strip()

        context = subprocess.run(
            ["./imo", "codex", "context", "--empty"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if context.returncode != 0 or "telemetry smoke" not in context.stdout:
            print("[imo verify] failed: telemetry context digest injection", file=sys.stderr)
            return False

        disabled = subprocess.run(
            ["./imo", "learning", "digest", "disable", digest_id, "--reason", "verify telemetry disable"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if disabled.returncode != 0:
            print("[imo verify] failed: telemetry digest disable", file=sys.stderr)
            return False

        populated_summary = subprocess.run(
            ["./imo", "learning", "metrics", "summary", "--json"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if populated_summary.returncode != 0:
            print("[imo verify] failed: populated metrics summary", file=sys.stderr)
            return False
        payload = json.loads(populated_summary.stdout)
        event_counts = payload.get("event_counts", {})
        expected_minimums = {
            "signal_created": 1,
            "activity_marked": 1,
            "prepare_skipped": 1,
            "prepare_completed": 1,
            "inbox_viewed": 1,
            "candidate_approved": 1,
            "context_digest_injected": 1,
            "digest_disabled": 1,
        }
        for event_type, minimum in expected_minimums.items():
            if not isinstance(event_counts, dict) or event_counts.get(event_type, 0) < minimum:
                print(f"[imo verify] failed: missing telemetry event {event_type}", file=sys.stderr)
                return False
        if payload.get("prepare_skip_by_reason", {}).get("x" * 117 + "...", 0) != 1:
            print("[imo verify] failed: compact prepare skip reason", file=sys.stderr)
            return False
        candidate_counts = payload.get("candidate_counts", {})
        review_decisions = payload.get("review_decisions", {})
        digest_controls = payload.get("digest_controls", {})
        safety = payload.get("safety", {})
        if candidate_counts.get("created", 0) < 1:
            print("[imo verify] failed: telemetry candidate created count", file=sys.stderr)
            return False
        if review_decisions.get("approved", 0) < 1:
            print("[imo verify] failed: telemetry approved decision count", file=sys.stderr)
            return False
        if digest_controls.get("disabled", 0) < 1:
            print("[imo verify] failed: telemetry digest disabled count", file=sys.stderr)
            return False
        if payload.get("context_digest_injected_count", 0) < 1:
            print("[imo verify] failed: telemetry context digest injected count", file=sys.stderr)
            return False
        if safety.get("active_task_interruption_count") != 0 or safety.get("auto_promotion_count") != 0:
            print("[imo verify] failed: telemetry safety counters", file=sys.stderr)
            return False

        print("[imo verify] ok: learning telemetry metrics")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning telemetry metrics: {exc}", file=sys.stderr)
        return False
    finally:
        if learning_dir.exists():
            shutil.rmtree(learning_dir)
        if session_dir.exists():
            shutil.rmtree(session_dir)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                learning_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, learning_dir, dirs_exist_ok=True)
            backup_session = backup_dir / "session"
            if backup_session.exists():
                session_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_session, session_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)

