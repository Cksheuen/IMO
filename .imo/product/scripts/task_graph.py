#!/usr/bin/env python3
"""Build and inspect the IMO task graph overlay for Trellis tasks."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any

import root_resolver

SOURCE_ROOT = Path(__file__).resolve().parents[3]
PROJECT_ROOT = root_resolver.resolve_project_root() or Path.cwd().resolve()
DEFAULT_TRELLIS_TASKS_DIR = PROJECT_ROOT / ".trellis/tasks"
RUNS_DIR = PROJECT_ROOT / ".imo/.runtime/task-graph/runs"
SCHEMA_VERSION = 1
COMPLETE_STATUSES = {"completed", "complete", "done"}
INACTIVE_STATUSES = COMPLETE_STATUSES | {"archived", "cancelled", "canceled"}
EDGE_TYPES = {"parent-child", "depends-on", "related-to", "blocks", "evidence-for"}
AGENT_TYPES = {"implementer", "researcher", "reviewer", "planner"}
REFERENCE_PATTERN = re.compile(r"\.trellis/tasks/([A-Za-z0-9_.-]+)")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_ref(value: str) -> str:
    value = value.strip().strip("/")
    if value.startswith(".trellis/tasks/"):
        value = value.removeprefix(".trellis/tasks/")
    return value.split("/", 1)[0]


def list_strings(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item]
    return []


def meta_value(task: dict[str, Any], *keys: str) -> Any:
    meta = task.get("meta")
    containers = [task]
    if isinstance(meta, dict):
        containers.extend(
            item
            for item in (
                meta,
                meta.get("task_graph"),
                meta.get("orchestrate"),
                meta.get("imo_task_graph"),
            )
            if isinstance(item, dict)
        )
    for container in containers:
        for key in keys:
            if key in container:
                return container[key]
    return None


def load_task_json(path: Path, warnings: list[str]) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        warnings.append(f"failed to read {path}: {exc}")
        return None
    except json.JSONDecodeError as exc:
        warnings.append(f"invalid task json {path}: {exc}")
        return None
    if not isinstance(data, dict):
        warnings.append(f"task json root must be object: {path}")
        return None
    return data


def iter_task_dirs(tasks_dir: Path) -> list[Path]:
    if not tasks_dir.is_dir():
        return []
    task_dirs = []
    for path in tasks_dir.iterdir():
        if not path.is_dir() or path.name == "archive" or path.name.startswith("."):
            continue
        if (path / "task.json").is_file():
            task_dirs.append(path)
    return sorted(task_dirs, key=lambda item: item.name)


def normalize_agent_type(value: Any) -> str:
    agent_type = str(value or "implementer").strip().lower()
    if agent_type in {"docs", "doc", "documentation"}:
        return "researcher"
    if agent_type not in AGENT_TYPES:
        return "implementer"
    return agent_type


def make_node(task_dir: Path, task: dict[str, Any], source_root: str) -> dict[str, Any]:
    node_id = task_dir.name
    dependencies = [normalize_ref(item) for item in list_strings(meta_value(task, "dependencies", "depends_on"))]
    related_files = list_strings(task.get("relatedFiles"))
    files_to_read = list_strings(meta_value(task, "files_to_read", "read_files")) or related_files
    return {
        "node_id": node_id,
        "trellis_ref": f".trellis/tasks/{node_id}",
        "title": str(task.get("title") or task.get("name") or node_id),
        "status": str(task.get("status") or "unknown"),
        "agent_type": normalize_agent_type(meta_value(task, "agent_type") or task.get("dev_type")),
        "files_to_read": files_to_read,
        "files_to_modify": list_strings(meta_value(task, "files_to_modify", "modify_files", "files")),
        "dependencies": dependencies,
        "expected_artifact": meta_value(task, "expected_artifact", "artifact"),
        "source": f"{source_root}/{node_id}/task.json",
    }


def add_edge(edges: list[dict[str, str]], seen: set[tuple[str, str, str]], from_id: str, to_id: str, edge_type: str, source: str) -> None:
    from_id = normalize_ref(from_id)
    to_id = normalize_ref(to_id)
    if not from_id or not to_id or from_id == to_id or edge_type not in EDGE_TYPES:
        return
    key = (from_id, to_id, edge_type)
    if key in seen:
        return
    seen.add(key)
    edge_id = f"{edge_type}:{from_id}->{to_id}"
    edges.append({"edge_id": edge_id, "from": from_id, "to": to_id, "type": edge_type, "source": source})


def scan_markdown_refs(task_dir: Path) -> set[str]:
    refs: set[str] = set()
    for path in sorted(task_dir.glob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        refs.update(normalize_ref(match.group(1)) for match in REFERENCE_PATTERN.finditer(text))
    return refs


def _meta_edge_refs(task: dict[str, Any], key: str) -> list[str]:
    return list_strings(meta_value(task, key))


def default_tasks_dir() -> Path:
    override = os.environ.get("IMO_TASK_GRAPH_TASKS_DIR")
    if override:
        return Path(override).resolve()
    return DEFAULT_TRELLIS_TASKS_DIR


def display_tasks_dir(tasks_dir: Path) -> str:
    try:
        return tasks_dir.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(tasks_dir)


def build_graph(tasks_dir: Path | None = None) -> dict[str, Any]:
    tasks_dir = tasks_dir or default_tasks_dir()
    source_root = display_tasks_dir(tasks_dir)
    warnings: list[str] = []
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    seen_edges: set[tuple[str, str, str]] = set()
    task_by_dir: dict[str, dict[str, Any]] = {}

    for task_dir in iter_task_dirs(tasks_dir):
        task = load_task_json(task_dir / "task.json", warnings)
        if task is None:
            continue
        task_by_dir[task_dir.name] = task
        nodes.append(make_node(task_dir, task, source_root))

    known = {node["node_id"] for node in nodes}
    aliases: dict[str, str] = {}
    for node in nodes:
        task = task_by_dir[node["node_id"]]
        for alias in (node["node_id"], str(task.get("id") or ""), str(task.get("name") or "")):
            if alias:
                aliases[alias] = node["node_id"]

    for node in nodes:
        task = task_by_dir[node["node_id"]]
        source = node["source"]
        parent = task.get("parent")
        if isinstance(parent, str) and parent:
            parent_id = aliases.get(normalize_ref(parent), normalize_ref(parent))
            add_edge(edges, seen_edges, parent_id, node["node_id"], "parent-child", source)
        for child in list_strings(task.get("children")):
            child_id = aliases.get(normalize_ref(child), normalize_ref(child))
            add_edge(edges, seen_edges, node["node_id"], child_id, "parent-child", source)
        for dep in list(node["dependencies"]):
            dep_id = aliases.get(normalize_ref(dep), normalize_ref(dep))
            add_edge(edges, seen_edges, dep_id, node["node_id"], "depends-on", source)
        for key, edge_type in (("related_to", "related-to"), ("blocks", "blocks"), ("evidence_for", "evidence-for")):
            for ref in _meta_edge_refs(task, key):
                ref_id = aliases.get(normalize_ref(ref), normalize_ref(ref))
                add_edge(edges, seen_edges, node["node_id"], ref_id, edge_type, source)
        for ref in scan_markdown_refs(tasks_dir / node["node_id"]):
            ref_id = aliases.get(ref, ref)
            if ref_id in known:
                add_edge(edges, seen_edges, node["node_id"], ref_id, "related-to", f".trellis/tasks/{node['node_id']}/*.md")

    for node in nodes:
        deps = sorted({edge["from"] for edge in edges if edge["type"] == "depends-on" and edge["to"] == node["node_id"]})
        node["dependencies"] = deps

    graph = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now(),
        "source": {
            "trellis_tasks_dir": source_root,
            "project_root": str(PROJECT_ROOT),
            "missing_trellis_tasks": not tasks_dir.is_dir(),
        },
        "nodes": sorted(nodes, key=lambda item: item["node_id"]),
        "edges": sorted(edges, key=lambda item: item["edge_id"]),
        "planning": {},
        "warnings": warnings,
    }
    graph["planning"] = plan_graph(graph)
    return graph


def plan_graph(graph: dict[str, Any]) -> dict[str, Any]:
    nodes = {node["node_id"]: node for node in graph.get("nodes", [])}
    ready: list[str] = []
    blocked: list[dict[str, Any]] = []
    missing_targets: set[str] = set()

    for node_id, node in nodes.items():
        if str(node.get("status", "")).lower() in INACTIVE_STATUSES:
            continue
        reasons = []
        if node.get("agent_type") == "implementer" and not node.get("files_to_modify"):
            reasons.append("missing explicit files_to_modify ownership")
        for dep in node.get("dependencies", []):
            dep_node = nodes.get(dep)
            if dep_node is None:
                missing_targets.add(dep)
                reasons.append(f"missing dependency target: {dep}")
            elif str(dep_node.get("status", "")).lower() not in COMPLETE_STATUSES:
                reasons.append(f"dependency not complete: {dep} ({dep_node.get('status', 'unknown')})")
        if reasons:
            blocked.append({"node_id": node_id, "reasons": reasons})
        else:
            ready.append(node_id)

    by_write: dict[str, list[str]] = {}
    for node in nodes.values():
        for path in node.get("files_to_modify", []):
            by_write.setdefault(path, []).append(node["node_id"])
    conflicts = [
        {"path": path, "node_ids": sorted(node_ids)}
        for path, node_ids in sorted(by_write.items())
        if path and len(node_ids) > 1
    ]

    selected: list[str] = []
    owned: set[str] = set()
    for node_id in ready:
        writes = [path for path in nodes[node_id].get("files_to_modify", []) if path]
        if any(path in owned for path in writes):
            continue
        selected.append(node_id)
        owned.update(writes)

    return {
        "ready_nodes": ready,
        "blocked_nodes": blocked,
        "missing_dependency_targets": sorted(missing_targets),
        "writable_file_conflicts": conflicts,
        "candidate_parallel_batches": [selected] if selected else [],
    }


def resolve_task(graph: dict[str, Any], ref: str) -> dict[str, Any] | None:
    ref = normalize_ref(ref)
    for node in graph.get("nodes", []):
        task_path = PROJECT_ROOT / node["trellis_ref"] / "task.json"
        task = load_task_json(task_path, [])
        aliases = {node["node_id"], Path(node["trellis_ref"]).name}
        if task:
            aliases.update(str(task.get(key) or "") for key in ("id", "name", "title"))
        if ref in aliases:
            return node
    return None


def emit_json(data: Any) -> int:
    print(json.dumps(data, indent=2, sort_keys=True))
    return 0


def print_graph(graph: dict[str, Any]) -> int:
    print("IMO task graph")
    print(f"source: {graph['source']['trellis_tasks_dir']}")
    print(f"nodes: {len(graph['nodes'])}")
    print(f"edges: {len(graph['edges'])}")
    if graph["source"]["missing_trellis_tasks"]:
        print("state: no .trellis/tasks directory found")
    for warning in graph.get("warnings", []):
        print(f"warning: {warning}")
    for node in graph.get("nodes", []):
        print(f"- {node['node_id']}\t{node['status']}\t{node['title']}")
    return 0


def print_show(graph: dict[str, Any], ref: str, *, include_docs: bool = False) -> int:
    node = resolve_task(graph, ref)
    if node is None:
        print(f"task not found: {ref}", file=sys.stderr)
        return 1
    print(f"{node['node_id']}: {node['title']}")
    print(f"status: {node['status']}")
    print(f"trellis_ref: {node['trellis_ref']}")
    print(f"agent_type: {node['agent_type']}")
    print(f"files_to_read: {', '.join(node['files_to_read']) or '(none)'}")
    print(f"files_to_modify: {', '.join(node['files_to_modify']) or '(none)'}")
    print(f"dependencies: {', '.join(node['dependencies']) or '(none)'}")
    print(f"expected_artifact: {node['expected_artifact'] or '(none)'}")
    outgoing = [edge for edge in graph["edges"] if edge["from"] == node["node_id"]]
    incoming = [edge for edge in graph["edges"] if edge["to"] == node["node_id"]]
    if incoming:
        print("incoming:")
        for edge in incoming:
            print(f"  - {edge['type']}: {edge['from']} -> {edge['to']}")
    if outgoing:
        print("outgoing:")
        for edge in outgoing:
            print(f"  - {edge['type']}: {edge['from']} -> {edge['to']}")
    if include_docs:
        prd_path = PROJECT_ROOT / node["trellis_ref"] / "prd.md"
        if prd_path.is_file():
            print("\nprd:")
            text = prd_path.read_text(encoding="utf-8")
            print(text[:4000].rstrip())
            if len(text) > 4000:
                print("\n[truncated]")
    return 0


def print_plan(graph: dict[str, Any]) -> int:
    planning = graph["planning"]
    print("IMO task graph plan (advisory)")
    print("ready:")
    for node_id in planning["ready_nodes"]:
        print(f"  - {node_id}")
    if not planning["ready_nodes"]:
        print("  (none)")
    print("blocked:")
    for item in planning["blocked_nodes"]:
        print(f"  - {item['node_id']}: {'; '.join(item['reasons'])}")
    if not planning["blocked_nodes"]:
        print("  (none)")
    print("writable-file conflicts:")
    for item in planning["writable_file_conflicts"]:
        print(f"  - {item['path']}: {', '.join(item['node_ids'])}")
    if not planning["writable_file_conflicts"]:
        print("  (none)")
    print("candidate parallel batches:")
    for batch in planning["candidate_parallel_batches"]:
        print(f"  - {', '.join(batch)}")
    if not planning["candidate_parallel_batches"]:
        print("  (none)")
    return 0


def graph_digest(graph: dict[str, Any]) -> str:
    payload = {
        "nodes": graph.get("nodes", []),
        "edges": graph.get("edges", []),
        "planning": graph.get("planning", {}),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def selected_subgraph(graph: dict[str, Any], root_ref: str) -> list[dict[str, Any]]:
    root = resolve_task(graph, root_ref)
    if root is None:
        return []
    selected = {root["node_id"]}
    changed = True
    while changed:
        changed = False
        for edge in graph.get("edges", []):
            if edge["type"] == "parent-child" and edge["from"] in selected and edge["to"] not in selected:
                selected.add(edge["to"])
                changed = True
    return [node for node in graph.get("nodes", []) if node["node_id"] in selected]


def detect_cycles(nodes: list[dict[str, Any]]) -> list[str]:
    node_ids = {node["node_id"] for node in nodes}
    dependencies = {
        node["node_id"]: [dep for dep in node.get("dependencies", []) if dep in node_ids]
        for node in nodes
    }
    visiting: set[str] = set()
    visited: set[str] = set()
    cycles: list[str] = []

    def visit(node_id: str, stack: list[str]) -> None:
        if node_id in visiting:
            cycle = stack[stack.index(node_id):] + [node_id] if node_id in stack else stack + [node_id]
            cycles.append(" -> ".join(cycle))
            return
        if node_id in visited:
            return
        visiting.add(node_id)
        for dep in dependencies.get(node_id, []):
            visit(dep, stack + [dep])
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in sorted(node_ids):
        visit(node_id, [node_id])
    return cycles


def validate_run_gates(graph: dict[str, Any], root_ref: str) -> tuple[list[dict[str, Any]], list[str]]:
    nodes = selected_subgraph(graph, root_ref)
    if not nodes:
        return [], [f"task not found: {root_ref}"]
    node_ids = {node["node_id"] for node in nodes}
    errors: list[str] = []
    for node in nodes:
        if str(node.get("status", "")).lower() in COMPLETE_STATUSES:
            continue
        if node.get("agent_type") == "implementer" and not node.get("files_to_modify"):
            errors.append(f"{node['node_id']} lacks explicit files_to_modify ownership")
        for dep in node.get("dependencies", []):
            if dep not in {item["node_id"] for item in graph.get("nodes", [])}:
                errors.append(f"{node['node_id']} depends on missing target {dep}")
            elif dep not in node_ids:
                dep_node = next(item for item in graph.get("nodes", []) if item["node_id"] == dep)
                if str(dep_node.get("status", "")).lower() not in COMPLETE_STATUSES:
                    errors.append(f"{node['node_id']} external dependency is not complete: {dep}")
    writes: dict[str, list[str]] = {}
    for node in nodes:
        for path in node.get("files_to_modify", []):
            writes.setdefault(path, []).append(node["node_id"])
    for path, owners in writes.items():
        if path and len(owners) > 1:
            errors.append(f"writable file conflict {path}: {', '.join(sorted(owners))}")
    for cycle in detect_cycles(nodes):
        errors.append(f"dependency cycle detected: {cycle}")
    return nodes, errors


def graph_to_orchestrate_state(graph: dict[str, Any], nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """Convert graph nodes into an OrchestrateState-compatible dictionary."""
    id_by_node = {node["node_id"]: index + 1 for index, node in enumerate(nodes)}
    subtasks = []
    for node in nodes:
        runtime_agent_type = "researcher" if node["agent_type"] == "planner" else node["agent_type"]
        subtasks.append(
            {
                "id": id_by_node[node["node_id"]],
                "description": node["title"],
                "agent_type": runtime_agent_type,
                "files_to_modify": node["files_to_modify"],
                "files_to_read": node["files_to_read"],
                "dependencies": [id_by_node[dep] for dep in node["dependencies"] if dep in id_by_node],
                "status": "pending",
                "recommended_model": None,
                "routing_reason": None,
                "result": None,
                "expected_artifact": node["expected_artifact"],
                "started_at": None,
                "completed_at": None,
                "final_summary": None,
                "productive": False,
                "observability": {},
            }
        )
    return {
        "task_id": nodes[0]["node_id"] if nodes else "task-graph",
        "task_description": nodes[0]["title"] if nodes else "Task graph run",
        "created_at": utc_now(),
        "prd": {
            "goal": nodes[0]["title"] if nodes else "",
            "from_user": [],
            "from_context": [node["trellis_ref"] for node in nodes],
            "assumptions": [],
            "open_questions": [],
            "requirements": [],
            "acceptance_criteria": [],
            "definition_of_done": [],
            "out_of_scope": [],
            "technical_notes": {"source": "IMO task graph"},
        },
        "subtasks": subtasks,
        "current_subtask_index": 0,
        "features": [],
        "completed_subtasks": [],
        "blocked_subtasks": [],
        "messages": [],
        "fixer_loop_active": False,
        "current_feature_id": None,
        "delta_context": None,
        "requires_user_confirmation": False,
        "user_confirmed": True,
        "verification_approved": None,
        "verification_feature_results": {},
        "errors": [],
    }


def summarize_orchestrate_state(state: dict[str, Any]) -> dict[str, Any]:
    subtasks = state.get("subtasks", [])
    features = state.get("features", [])
    return {
        "task_id": state.get("task_id"),
        "subtask_count": len(subtasks),
        "subtasks": [
            {
                "id": subtask.get("id"),
                "description": subtask.get("description"),
                "agent_type": subtask.get("agent_type"),
                "status": subtask.get("status"),
                "files_to_modify": subtask.get("files_to_modify", []),
                "files_to_read": subtask.get("files_to_read", []),
                "dependencies": subtask.get("dependencies", []),
                "expected_artifact": subtask.get("expected_artifact"),
                "recommended_model": subtask.get("recommended_model"),
                "final_summary": subtask.get("final_summary"),
                "observability": subtask.get("observability", {}),
            }
            for subtask in subtasks
        ],
        "errors": state.get("errors", []),
        "features": [
            {
                "id": feature.get("id"),
                "passes": feature.get("passes"),
                "attempt_count": feature.get("attempt_count"),
                "notes": feature.get("notes"),
            }
            for feature in features
        ],
    }


async def run_orchestrate_runtime(state: dict[str, Any]) -> dict[str, Any]:
    try:
        root_text = str(SOURCE_ROOT)
        if root_text not in sys.path:
            sys.path.insert(0, root_text)
        import skills.orchestrate.migrated.orchestrate as orchestrate
    except Exception as exc:  # pragma: no cover - environment diagnostic path
        raise RuntimeError(f"failed to import migrated orchestrate runtime: {exc}") from exc

    previous_complete = -1
    iterations = 0
    max_iterations = max(1, len(state.get("subtasks", [])) + 1)
    while iterations < max_iterations:
        iterations += 1
        ready = orchestrate.select_parallel_batch(orchestrate.get_ready_subtasks(state))
        if not ready:
            break
        updates = await orchestrate.execute_subtask_node(state)
        state.update(updates)
        complete = len([subtask for subtask in state.get("subtasks", []) if subtask.get("status") == "complete"])
        if complete == previous_complete and updates.get("errors"):
            break
        previous_complete = complete

    state.update(await orchestrate.aggregate_node(state))
    state.update(await orchestrate.verify_node(state))
    pending = [subtask for subtask in state.get("subtasks", []) if subtask.get("status") == "pending"]
    if pending:
        state.setdefault("errors", []).append(
            "orchestrate runtime ended with pending subtasks: "
            + ", ".join(str(subtask.get("id")) for subtask in pending)
        )
    return state


def cmd_run(graph: dict[str, Any], ref: str, *, as_json: bool) -> int:
    nodes, errors = validate_run_gates(graph, ref)
    if errors:
        payload = {"status": "refused", "errors": errors}
        if as_json:
            emit_json(payload)
            return 2
        print("task graph run refused")
        for error in errors:
            print(f"- {error}")
        return 2

    started = utc_now()
    state = graph_to_orchestrate_state(graph, nodes)
    try:
        final_state = asyncio.run(run_orchestrate_runtime(state))
    except Exception as exc:
        payload = {
            "status": "failed",
            "errors": [str(exc)],
            "executor_backend": "migrated-orchestrate-real",
        }
        if as_json:
            emit_json(payload)
            return 1
        print("task graph run failed")
        print(f"- {exc}")
        return 1
    completed = utc_now()
    run_id = f"task-graph-{started.replace(':', '').replace('-', '')}"
    summary = {
        "run_id": run_id,
        "executor_backend": "migrated-orchestrate-real",
        "input_graph_digest": graph_digest(graph),
        "started_at": started,
        "completed_at": completed,
        "orchestrate_state_summary": summarize_orchestrate_state(final_state),
        "completed_subtask_count": len([s for s in final_state.get("subtasks", []) if s.get("status") == "complete"]),
        "blocked_subtask_count": len([s for s in final_state.get("subtasks", []) if s.get("status") == "blocked"]),
        "feature_verification_summary": {
            "feature_count": len(final_state.get("features", [])),
            "approved": final_state.get("verification_approved"),
        },
        "errors": final_state.get("errors", []),
    }
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = RUNS_DIR / f"{run_id}.json"
    output_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if as_json:
        emit_json(summary)
        return 1 if summary["errors"] else 0
    print(f"task graph run summary: {output_path.relative_to(PROJECT_ROOT)}")
    print(f"executor_backend: {summary['executor_backend']}")
    print(f"subtasks: {len(final_state.get('subtasks', []))}")
    if summary["errors"]:
        print("errors:")
        for error in summary["errors"]:
            print(f"- {error}")
        return 1
    return 0


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect the IMO task graph overlay for Trellis tasks.")
    subparsers = parser.add_subparsers(dest="command")
    parser.add_argument("--json", action="store_true", help="emit JSON for the default graph command")

    show = subparsers.add_parser("show", help="show one task graph node")
    show.add_argument("task")
    show.add_argument("--json", action="store_true")

    read = subparsers.add_parser("read", help="show one task and PRD excerpt")
    read.add_argument("task")
    read.add_argument("--json", action="store_true")

    plan = subparsers.add_parser("plan", help="show advisory readiness and parallel batch plan")
    plan.add_argument("task", nargs="?")
    plan.add_argument("--json", action="store_true")

    run = subparsers.add_parser("run", help="run a gated graph selection through orchestrate")
    run.add_argument("task")
    run.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = make_parser()
    args = parser.parse_args(argv)
    graph = build_graph()

    if args.command is None:
        if args.json:
            return emit_json(graph)
        return print_graph(graph)
    if args.command == "show":
        node = resolve_task(graph, args.task)
        if args.json:
            return emit_json(node or {"error": f"task not found: {args.task}"})
        return print_show(graph, args.task)
    if args.command == "read":
        if args.json:
            node = resolve_task(graph, args.task)
            if node is None:
                return emit_json({"error": f"task not found: {args.task}"})
            prd_path = PROJECT_ROOT / node["trellis_ref"] / "prd.md"
            payload = dict(node)
            payload["prd"] = prd_path.read_text(encoding="utf-8") if prd_path.is_file() else ""
            return emit_json(payload)
        return print_show(graph, args.task, include_docs=True)
    if args.command == "plan":
        if args.json:
            return emit_json(graph["planning"])
        return print_plan(graph)
    if args.command == "run":
        return cmd_run(graph, args.task, as_json=args.json)
    parser.print_help()
    return 64


if __name__ == "__main__":
    raise SystemExit(main())
