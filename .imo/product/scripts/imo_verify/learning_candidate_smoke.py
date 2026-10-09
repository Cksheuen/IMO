from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .runner import ROOT, fixture_runtime_root


def _run_learning_candidate_smoke() -> bool:
    print("[imo verify] learning candidate behavior")
    runtime_dir = fixture_runtime_root() / "learning"
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
