from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT


def _write_digest(path: Path, digest_id: str, scope: str, summary: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "items": [
                    {
                        "digest_version": "1",
                        "id": digest_id,
                        "last_updated": "2026-05-22T00:00:00Z",
                        "priority": "high",
                        "rollback_id": "verify:rollback",
                        "scope": scope,
                        "source_candidates": [f"candidate-{digest_id}"],
                        "status": "active",
                        "summary": summary,
                    }
                ]
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _run_global_project_scope_smoke() -> bool:
    print("[imo verify] global/project scope behavior")
    project_learning = ROOT / ".imo/.runtime/learning"
    project_digest = project_learning / "digest.json"
    backup_dir: Path | None = None
    global_root = Path(tempfile.mkdtemp(prefix="imo-global-root-"))
    try:
        if project_learning.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-learning-backup-"))
            shutil.copytree(project_learning, backup_dir / "learning", dirs_exist_ok=True)
            shutil.rmtree(project_learning)

        _write_digest(project_digest, "digest-project-scope", "project", "Project scoped digest")
        _write_digest(
            global_root / "runtime/learning/digest.json",
            "digest-global-scope",
            "global",
            "Global shared digest",
        )
        env = os.environ.copy()
        env["IMO_GLOBAL_ROOT"] = str(global_root)

        merged = subprocess.run(
            ["./imo", "learning", "list", "--scope", "merged"],
            cwd=ROOT,
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if merged.returncode != 0 or "Project scoped digest" not in merged.stdout or "Global shared digest" not in merged.stdout:
            print("[imo verify] failed: merged learning scope", file=sys.stderr)
            if merged.stderr:
                print(merged.stderr, file=sys.stderr)
            return False

        context = subprocess.run(
            ["./imo", "codex", "context", "--empty"],
            cwd=ROOT,
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if context.returncode != 0:
            print("[imo verify] failed: merged codex context", file=sys.stderr)
            if context.stderr:
                print(context.stderr, file=sys.stderr)
            return False
        project_index = context.stdout.find("Project scoped digest")
        global_index = context.stdout.find("Global shared digest")
        if project_index < 0 or global_index < 0 or project_index > global_index:
            print("[imo verify] failed: context digest precedence", file=sys.stderr)
            return False

        graph = subprocess.run(
            ["./imo", "task", "graph", "--json"],
            cwd=ROOT,
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if graph.returncode != 0:
            print("[imo verify] failed: project graph locality command", file=sys.stderr)
            if graph.stderr:
                print(graph.stderr, file=sys.stderr)
            return False
        if (global_root / "runtime/task-graph").exists():
            print("[imo verify] failed: task graph wrote global runtime", file=sys.stderr)
            return False

        custom_hook = global_root / "hooks/codex-context.sh"
        custom_hook.parent.mkdir(parents=True, exist_ok=True)
        custom_hook.write_text("#!/usr/bin/env bash\necho custom\n", encoding="utf-8")
        conflict = subprocess.run(
            ["./imo", "global", "install", "--global-root", str(global_root), "--apply"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if conflict.returncode == 0 or "refused to overwrite unmanaged file" not in conflict.stderr:
            print("[imo verify] failed: global install conflict guard", file=sys.stderr)
            if conflict.stderr:
                print(conflict.stderr, file=sys.stderr)
            return False

        installed = subprocess.run(
            ["./imo", "global", "install", "--global-root", str(global_root), "--apply", "--force"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if installed.returncode != 0 or not (global_root / "hooks/codex-context.sh").is_file():
            print("[imo verify] failed: global install shim", file=sys.stderr)
            if installed.stderr:
                print(installed.stderr, file=sys.stderr)
            return False

        print("[imo verify] ok: global/project scope behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: global/project scope behavior: {exc}", file=sys.stderr)
        return False
    finally:
        if project_learning.exists():
            shutil.rmtree(project_learning)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                project_learning.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, project_learning, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)
        shutil.rmtree(global_root, ignore_errors=True)
