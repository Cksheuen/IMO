from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT, fixture_runtime_root


def _run_learning_signal_smoke() -> bool:
    print("[imo verify] learning raw signal behavior")
    runtime_dir = fixture_runtime_root() / "learning"
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
