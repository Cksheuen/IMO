from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT, fixture_runtime_root


def _run_learning_deferred_review_smoke() -> bool:
    print("[imo verify] learning deferred review behavior")
    learning_dir = fixture_runtime_root() / "learning"
    session_dir = fixture_runtime_root() / "session"
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

        metrics = subprocess.run(
            ["./imo", "learning", "metrics", "summary", "--json"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if metrics.returncode != 0:
            print(
                f"[imo verify] failed: learning metrics summary: {metrics.stderr}",
                file=sys.stderr,
            )
            return False
        payload = json.loads(metrics.stdout)
        if payload.get("safety", {}).get("auto_promotion_count") != 0:
            print(
                "[imo verify] failed: auto_promotion_count after explicit approval",
                file=sys.stderr,
            )
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
