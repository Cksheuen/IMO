from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .runner import ROOT, fixture_runtime_root


def _run_learning_telemetry_smoke() -> bool:
    print("[imo verify] learning telemetry metrics")
    learning_dir = fixture_runtime_root() / "learning"
    session_dir = fixture_runtime_root() / "session"
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
