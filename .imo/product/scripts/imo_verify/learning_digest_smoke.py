from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .runner import ROOT, fixture_runtime_root


def _run_learning_digest_smoke() -> bool:
    print("[imo verify] learning digest controls")
    runtime_dir = fixture_runtime_root() / "learning"
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
