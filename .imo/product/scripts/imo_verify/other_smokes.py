from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT, no_event_env


def _run_defensive_audit_smoke() -> bool:
    print("[imo verify] defensive programming audit")
    human = subprocess.run(
        ["./imo", "defensive", "audit"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if human.returncode != 0 or "IMO Defensive Programming Audit" not in human.stdout:
        print("[imo verify] failed: defensive audit human report", file=sys.stderr)
        if human.stderr:
            print(human.stderr, file=sys.stderr)
        return False

    as_json = subprocess.run(
        ["./imo", "defensive", "audit", "--json"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if as_json.returncode != 0:
        print("[imo verify] failed: defensive audit json report", file=sys.stderr)
        if as_json.stderr:
            print(as_json.stderr, file=sys.stderr)
        return False
    try:
        report = __import__("json").loads(as_json.stdout)
    except ValueError as exc:
        print(f"[imo verify] failed: defensive audit json parse: {exc}", file=sys.stderr)
        return False
    summary = report.get("summary", {})
    categories = summary.get("by_category", {}) if isinstance(summary, dict) else {}
    expected = {"keep", "simplify", "replace-with-contract", "remove"}
    if report.get("schema_version") != 1 or not expected.issubset(categories):
        print("[imo verify] failed: defensive audit contract shape", file=sys.stderr)
        return False
    if not isinstance(report.get("findings"), list) or not report["findings"]:
        print("[imo verify] failed: defensive audit expected findings", file=sys.stderr)
        return False

    print("[imo verify] ok: defensive programming audit")
    return True


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
            env=no_event_env(),
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
