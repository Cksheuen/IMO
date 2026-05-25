#!/usr/bin/env python3
"""Validate IMO task graph contracts without creating runtime state."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / ".imo/runtime/task-graph/CONTRACT.md"
SCHEMA_PATH = ROOT / ".imo/runtime/task-graph/schema.json"
SCRIPT_DIR = ROOT / ".imo/product/scripts"
TASK_GRAPH_PATH = SCRIPT_DIR / "task_graph.py"
IMO_SH_PATH = SCRIPT_DIR / "imo.sh"

REQUIRED_NODE_FIELDS = {
    "node_id",
    "trellis_ref",
    "title",
    "status",
    "agent_type",
    "files_to_read",
    "files_to_modify",
    "dependencies",
    "expected_artifact",
    "source",
}
REQUIRED_EDGE_FIELDS = {"edge_id", "from", "to", "type", "source"}
REQUIRED_EDGE_TYPES = {"parent-child", "depends-on", "related-to", "blocks", "evidence-for"}
REQUIRED_PLANNING_FIELDS = {
    "ready_nodes",
    "blocked_nodes",
    "missing_dependency_targets",
    "writable_file_conflicts",
    "candidate_parallel_batches",
}
REQUIRED_RUN_FIELDS = {
    "run_id",
    "executor_backend",
    "input_graph_digest",
    "started_at",
    "completed_at",
    "orchestrate_state_summary",
    "completed_subtask_count",
    "blocked_subtask_count",
    "feature_verification_summary",
    "errors",
}


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _required_fields(schema: dict[str, Any], def_name: str) -> set[str]:
    defs = schema.get("$defs", {})
    target = defs.get(def_name, {}) if isinstance(defs, dict) else {}
    required = target.get("required", []) if isinstance(target, dict) else []
    return {item for item in required if isinstance(item, str)}


def main() -> int:
    errors: list[str] = []
    if not CONTRACT_PATH.is_file():
        errors.append(f"missing contract: {CONTRACT_PATH}")
    else:
        contract = CONTRACT_PATH.read_text(encoding="utf-8")
        contract_lower = contract.lower()
        for phrase in (
            "Trellis remains the task plane",
            "does not create, edit, archive, start, or complete Trellis tasks",
            "Graph, show, read, and plan commands are read-only",
            "Missing `.trellis/tasks/` is an empty graph",
            "invokes real orchestrate execution",
            "explicit file ownership, dependency validation, and isolation",
            ".imo/.runtime/task-graph/runs/",
        ):
            if phrase.lower() not in contract_lower:
                errors.append(f"contract missing required phrase: {phrase}")

    try:
        schema = _load_json(SCHEMA_PATH)
    except OSError as exc:
        errors.append(f"failed to read schema: {exc}")
        schema = {}
    except json.JSONDecodeError as exc:
        errors.append(f"invalid schema json: {exc}")
        schema = {}

    if not isinstance(schema, dict):
        errors.append("schema root must be an object")
        schema = {}
    if schema.get("type") != "object":
        errors.append("schema must declare type=object")
    if schema.get("additionalProperties") is not False:
        errors.append("schema root must reject additional properties")

    root_required = set(schema.get("required", []))
    expected_root = {"schema_version", "generated_at", "source", "nodes", "edges", "planning", "warnings"}
    if expected_root - root_required:
        errors.append(f"schema missing root fields: {', '.join(sorted(expected_root - root_required))}")

    for def_name, expected in (
        ("node", REQUIRED_NODE_FIELDS),
        ("edge", REQUIRED_EDGE_FIELDS),
        ("planning", REQUIRED_PLANNING_FIELDS),
        ("run_summary", REQUIRED_RUN_FIELDS),
    ):
        missing = expected - _required_fields(schema, def_name)
        if missing:
            errors.append(f"schema {def_name} missing fields: {', '.join(sorted(missing))}")

    edge = schema.get("$defs", {}).get("edge", {}) if isinstance(schema.get("$defs"), dict) else {}
    edge_type = edge.get("properties", {}).get("type", {}) if isinstance(edge, dict) else {}
    edge_values = set(edge_type.get("enum", [])) if isinstance(edge_type, dict) else set()
    if REQUIRED_EDGE_TYPES - edge_values:
        errors.append(f"schema edge types missing: {', '.join(sorted(REQUIRED_EDGE_TYPES - edge_values))}")

    if not TASK_GRAPH_PATH.is_file():
        errors.append(f"missing task graph script: {TASK_GRAPH_PATH}")
    else:
        script = TASK_GRAPH_PATH.read_text(encoding="utf-8")
        for phrase in ("build_graph", "plan_graph", "cmd_run", "run_orchestrate_runtime"):
            if phrase not in script:
                errors.append(f"task_graph.py missing implementation marker: {phrase}")

    if not IMO_SH_PATH.is_file():
        errors.append(f"missing IMO entrypoint: {IMO_SH_PATH}")
    else:
        shell = IMO_SH_PATH.read_text(encoding="utf-8")
        for phrase in ("task graph", "task_graph.py", "show|read|plan"):
            if phrase not in shell:
                errors.append(f"imo.sh missing task graph dispatch marker: {phrase}")

    runtime_path = ROOT / ".imo/.runtime/task-graph"
    if runtime_path.exists():
        before = sorted(path.relative_to(runtime_path).as_posix() for path in runtime_path.rglob("*"))
    else:
        before = []
    after = sorted(path.relative_to(runtime_path).as_posix() for path in runtime_path.rglob("*")) if runtime_path.exists() else []
    if before != after:
        errors.append("checker mutated task graph runtime state")

    if errors:
        print("[task graph contracts] failed", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("[task graph contracts] ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
