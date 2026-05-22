# IMO Task Graph Runtime Contract

`runtime/task-graph/` defines the stable contract for the IMO-owned task graph
overlay. The overlay references Trellis tasks, but Trellis remains the task plane.

## Purpose

The task graph gives IMO a read and planning surface for relationships between
Trellis-created tasks:

- task hierarchy from `.trellis/tasks/*/task.json`
- advisory dependency and relationship edges
- orchestrate-ready planning fields
- gated run summaries for explicit orchestrate execution

The graph is an overlay. It does not create, edit, archive, start, or complete Trellis tasks.

## Source And State Boundary

Tracked source:

- `.imo/runtime/task-graph/CONTRACT.md`
- `.imo/runtime/task-graph/schema.json`
- `.imo/product/scripts/task_graph.py`
- `.imo/product/scripts/check_task_graph_contracts.py`
- task graph checks wired into `./imo verify`

External source objects:

```text
.trellis/tasks/<task>/task.json
.trellis/tasks/<task>/prd.md
.trellis/tasks/<task>/*.md
```

Ignored local runtime state:

```text
<project>/.imo/.runtime/task-graph/runs/
```

Graph, show, read, and plan commands are read-only. They must not create
`.imo/.runtime/task-graph/`, mutate Trellis task JSON, or project host output
files. Missing `.trellis/tasks/` is an empty graph, not a crash.

Run summaries may be written only by an explicit run command, and only under
the current project's `.imo/.runtime/task-graph/runs/`. Global IMO runtime must
not store ordinary project task graph runs.

## Command Contract

Primary surface:

```bash
./imo task graph
./imo task graph --json
./imo task graph show <task-id-or-dir>
./imo task graph read <task-id-or-dir>
./imo task graph plan
./imo task graph run <task-id-or-dir>
```

Compatibility aliases may expose the same implementation as:

```bash
./imo graph
./imo show <task-id-or-dir>
./imo read <task-id-or-dir>
./imo plan [<task-id-or-dir>]
```

Rules:

- `graph`, `show`, `read`, and `plan` are read-only.
- run invokes real orchestrate execution only after readiness gates pass.
- Real execution requires explicit file ownership, dependency validation, and isolation.
- Trellis task JSON is not mutated by graph or orchestrate commands.
- The graph layer may derive edges from Trellis task metadata and markdown
  references, but it must not write manual relationship metadata in the MVP.

## Graph Model

Each node represents a Trellis task reference:

- `node_id`
- `trellis_ref`
- `title`
- `status`
- `agent_type`
- `files_to_read`
- `files_to_modify`
- `dependencies`
- `expected_artifact`
- `source`

Each edge records a relationship:

- `edge_id`
- `from`
- `to`
- `type`
- `source`

Supported edge types:

- `parent-child`
- `depends-on`
- `related-to`
- `blocks`
- `evidence-for`

## Planning Output

Planning output is advisory. It does not grant execution permission and must
not call orchestrate, spawn agents, create worktrees, create runtime caches, or
mutate Trellis task state.

Planning output contains:

- ready nodes
- blocked nodes with dependency reasons
- missing dependency targets
- writable-file conflicts
- candidate parallel batches

## Run Output

Run output is compact and persisted only after an explicit run passes safety
gates. A run summary contains:

- `run_id`
- `executor_backend`
- `input_graph_digest`
- `started_at`
- `completed_at`
- `orchestrate_state_summary`
- `completed_subtask_count`
- `blocked_subtask_count`
- `feature_verification_summary`
- `errors`

## Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| `.trellis/tasks/` is missing | return an empty graph |
| `graph`, `show`, `read`, or `plan` runs | read only; no `.imo/.runtime/task-graph/` creation |
| Trellis task JSON is malformed | report a warning and skip that task |
| dependency target is missing | report blocked planning state |
| writable files conflict in a candidate set | exclude conflicting nodes from the same batch and report the conflict |
| `run` lacks explicit file ownership | fail before execution and do not write a run summary |
| dependency validation fails | fail before execution and do not write a run summary |
| execution is explicitly started | use real orchestrate execution and write summary under current-project `.imo/.runtime/task-graph/runs/` |
| global IMO root is configured | graph commands must not create `~/.imo/runtime/task-graph/` |

## Good / Base / Bad Cases

Good:

- Trellis remains directly usable without IMO.
- IMO can inspect task relationships and planning metadata without mutating
  Trellis state.
- Run summaries are local, ignored, and scoped to task graph execution.

Base:

- No `.trellis/tasks/` directory exists; graph output is empty.
- Trellis tasks have no file ownership metadata; plan can report readiness, but
  run refuses before execution.

Bad:

- Treating the graph as a Trellis task editor.
- Writing derived graph caches during read-only commands.
- Starting orchestrate without explicit file ownership or dependency checks.
