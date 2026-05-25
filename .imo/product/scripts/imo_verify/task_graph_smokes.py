from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT, no_event_env


def _write_task(task_dir: Path, name: str, payload: dict[str, object]) -> None:
    target = task_dir / name
    target.mkdir(parents=True, exist_ok=True)
    (target / "task.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (target / "prd.md").write_text(f"# {payload.get('title', name)}\n", encoding="utf-8")


def _run_task_graph_smoke() -> bool:
    print("[imo verify] task graph behavior")
    runtime_dir = ROOT / ".imo/.runtime/task-graph"
    backup_dir: Path | None = None
    fixture_dir = Path(tempfile.mkdtemp(prefix="imo-task-graph-fixture-"))

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-task-graph-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "task-graph", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        read_env = no_event_env()
        graph = subprocess.run(
            ["./imo", "task", "graph", "--json"],
            cwd=ROOT,
            env=read_env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if graph.returncode != 0:
            print("[imo verify] failed: task graph json", file=sys.stderr)
            return False
        graph_payload = json.loads(graph.stdout)
        if not isinstance(graph_payload.get("nodes"), list) or not isinstance(graph_payload.get("edges"), list):
            print("[imo verify] failed: task graph shape", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: graph read created task graph runtime", file=sys.stderr)
            return False

        plan = subprocess.run(
            ["./imo", "task", "graph", "plan", "--json"],
            cwd=ROOT,
            env=read_env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if plan.returncode != 0:
            print("[imo verify] failed: task graph plan json", file=sys.stderr)
            return False
        plan_payload = json.loads(plan.stdout)
        if not isinstance(plan_payload.get("candidate_parallel_batches"), list):
            print("[imo verify] failed: task graph plan shape", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: graph plan created task graph runtime", file=sys.stderr)
            return False

        refused = subprocess.run(
            ["./imo", "task", "graph", "run", "05-22-imo-task-graph-references", "--json"],
            cwd=ROOT,
            env=read_env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if refused.returncode == 0:
            print("[imo verify] failed: unowned task graph run succeeded", file=sys.stderr)
            return False
        refused_payload = json.loads(refused.stdout)
        if refused_payload.get("status") != "refused" or not refused_payload.get("errors"):
            print("[imo verify] failed: refused run shape", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: refused run wrote task graph runtime", file=sys.stderr)
            return False

        fixture_tasks = fixture_dir / "tasks"
        _write_task(
            fixture_tasks,
            "root",
            {
                "id": "root",
                "name": "root",
                "title": "fixture root",
                "status": "in_progress",
                "children": ["child-a", "child-b"],
                "parent": None,
                "relatedFiles": ["README.md"],
                "meta": {"task_graph": {"agent_type": "researcher", "files_to_read": ["README.md"]}},
            },
        )
        _write_task(
            fixture_tasks,
            "child-a",
            {
                "id": "child-a",
                "name": "child-a",
                "title": "fixture child a",
                "status": "planning",
                "children": [],
                "parent": "root",
                "relatedFiles": [],
                "meta": {
                    "task_graph": {
                        "agent_type": "implementer",
                        "files_to_modify": [".imo/product/scripts/task_graph.py"],
                        "expected_artifact": "task graph smoke artifact",
                    }
                },
            },
        )
        _write_task(
            fixture_tasks,
            "child-b",
            {
                "id": "child-b",
                "name": "child-b",
                "title": "fixture child b",
                "status": "planning",
                "children": [],
                "parent": "root",
                "relatedFiles": [],
                "meta": {
                    "task_graph": {
                        "agent_type": "implementer",
                        "files_to_modify": [".imo/runtime/task-graph/CONTRACT.md"],
                        "expected_artifact": "task graph contract smoke artifact",
                    }
                },
            },
        )

        run_env = no_event_env()
        run_env["IMO_TASK_GRAPH_TASKS_DIR"] = str(fixture_tasks)
        accepted = subprocess.run(
            ["./imo", "task", "graph", "run", "root", "--json"],
            cwd=ROOT,
            env=run_env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if accepted.returncode != 0:
            print("[imo verify] failed: fixture task graph run", file=sys.stderr)
            if accepted.stdout:
                print(accepted.stdout, file=sys.stderr)
            if accepted.stderr:
                print(accepted.stderr, file=sys.stderr)
            return False
        accepted_payload = json.loads(accepted.stdout)
        if accepted_payload.get("completed_subtask_count") != 3:
            print("[imo verify] failed: fixture run did not complete all subtasks", file=sys.stderr)
            return False
        if accepted_payload.get("errors"):
            print("[imo verify] failed: fixture run reported errors", file=sys.stderr)
            return False
        if not list((runtime_dir / "runs").glob("task-graph-*.json")):
            print("[imo verify] failed: fixture run summary missing", file=sys.stderr)
            return False

        print("[imo verify] ok: task graph behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: task graph behavior: {exc}", file=sys.stderr)
        return False
    finally:
        shutil.rmtree(fixture_dir, ignore_errors=True)
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_task_graph = backup_dir / "task-graph"
            if backup_task_graph.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_task_graph, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)
