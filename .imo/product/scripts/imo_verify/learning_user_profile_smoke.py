from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .runner import ROOT


def _run_learning_user_profile_smoke() -> bool:
    print("[imo verify] learning user profile behavior")
    global_root = Path(tempfile.mkdtemp(prefix="imo-profile-global-"))
    export_path = global_root / "exported-profile.json"
    invalid_path = global_root / "invalid-profile.json"
    env = os.environ.copy()
    env["IMO_GLOBAL_ROOT"] = str(global_root)
    profile_path = global_root / "runtime/learning/user-profile.json"

    def run(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            cwd=ROOT,
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    try:
        missing_status = run(["./imo", "learning", "profile", "status"])
        if missing_status.returncode != 0 or "no user profile found" not in missing_status.stdout:
            print("[imo verify] failed: profile missing-state status", file=sys.stderr)
            return False
        missing_inspect = run(["./imo", "learning", "profile", "inspect", "--json"])
        if missing_inspect.returncode != 0:
            print("[imo verify] failed: profile missing-state inspect", file=sys.stderr)
            return False
        if profile_path.exists():
            print("[imo verify] failed: profile read created runtime state", file=sys.stderr)
            return False

        update = run(
            [
                "./imo",
                "learning",
                "profile",
                "update",
                "--summary",
                "The user values precise intent interpretation over generic preference recall.",
                "--meaning",
                "When the user says their words have specific meaning, infer the decision boundary they are drawing.",
                "--communication",
                "Prefer concise direct engineering language.",
                "--workflow",
                "Keep project-specific facts out of the global user profile.",
                "--source-ref",
                "verify:user-profile-smoke",
            ]
        )
        if update.returncode != 0 or not profile_path.exists():
            print("[imo verify] failed: profile update", file=sys.stderr)
            if update.stderr:
                print(update.stderr, file=sys.stderr)
            return False

        status_json = run(["./imo", "learning", "profile", "status", "--json"])
        if status_json.returncode != 0:
            print("[imo verify] failed: profile status json", file=sys.stderr)
            return False
        status_payload = json.loads(status_json.stdout)
        if status_payload.get("status") != "enabled":
            print("[imo verify] failed: profile status is not enabled", file=sys.stderr)
            return False

        context = run(["./imo", "codex", "context", "--empty"])
        if context.returncode != 0 or "User profile:" not in context.stdout:
            print("[imo verify] failed: profile context injection", file=sys.stderr)
            return False
        if "precise intent interpretation" not in context.stdout:
            print("[imo verify] failed: profile summary missing from context", file=sys.stderr)
            return False

        stats = run(["./imo", "codex", "context", "--empty", "--stats"])
        if stats.returncode != 0:
            print("[imo verify] failed: profile context stats", file=sys.stderr)
            return False
        stats_payload = json.loads(stats.stdout)
        if stats_payload.get("total_chars", 2201) > stats_payload.get("budget_chars", 0):
            print("[imo verify] failed: profile context exceeded budget", file=sys.stderr)
            return False
        if "user_profile" not in stats_payload.get("sections", {}):
            print("[imo verify] failed: profile section missing from context stats", file=sys.stderr)
            return False

        disabled = run(["./imo", "learning", "profile", "disable"])
        if disabled.returncode != 0:
            print("[imo verify] failed: profile disable", file=sys.stderr)
            return False
        disabled_context = run(["./imo", "codex", "context", "--empty"])
        if "precise intent interpretation" in disabled_context.stdout:
            print("[imo verify] failed: disabled profile injected", file=sys.stderr)
            return False
        disabled_stats = run(["./imo", "codex", "context", "--empty", "--stats"])
        if disabled_stats.returncode != 0:
            print("[imo verify] failed: disabled profile context stats", file=sys.stderr)
            return False
        disabled_payload = json.loads(disabled_stats.stdout)
        if "user_profile" in disabled_payload.get("sections", {}):
            print("[imo verify] failed: disabled profile reported in context stats", file=sys.stderr)
            return False
        enabled = run(["./imo", "learning", "profile", "enable"])
        if enabled.returncode != 0:
            print("[imo verify] failed: profile enable", file=sys.stderr)
            return False

        exported_stdout = run(["./imo", "learning", "profile", "export"])
        if exported_stdout.returncode != 0 or "user-profile-" not in exported_stdout.stdout:
            print("[imo verify] failed: profile export stdout", file=sys.stderr)
            return False
        exported_file = run(["./imo", "learning", "profile", "export", "--output", str(export_path)])
        if exported_file.returncode != 0 or not export_path.exists():
            print("[imo verify] failed: profile export file", file=sys.stderr)
            return False

        profile_path.unlink()
        imported = run(["./imo", "learning", "profile", "import", "--input", str(export_path)])
        if imported.returncode != 0 or not profile_path.exists():
            print("[imo verify] failed: profile import", file=sys.stderr)
            return False

        invalid_payload = json.loads(export_path.read_text(encoding="utf-8"))
        invalid_payload["privacy"]["contains_project_private"] = True
        invalid_path.write_text(json.dumps(invalid_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        rejected = run(["./imo", "learning", "profile", "import", "--input", str(invalid_path)])
        if rejected.returncode == 0 or "contains_project_private must be false" not in rejected.stderr:
            print("[imo verify] failed: project-private profile import was not rejected", file=sys.stderr)
            return False

        print("[imo verify] ok: learning user profile behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning user profile behavior: {exc}", file=sys.stderr)
        return False
    finally:
        shutil.rmtree(global_root, ignore_errors=True)
