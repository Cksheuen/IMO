# IMO Observability Runtime Contract

Unified observability is the local runtime visibility layer for IMO-owned
capabilities.

## Scope

Observability covers compact operational facts for:

- command execution
- verification checks
- learning metrics bridge
- profile status visibility
- orchestrate worker lifecycle events (Herdr instrumentation design; live wiring
  must be verified separately)

It does not own repository task state, host-output projection, remote telemetry,
or user consent decisions.

## Runtime Storage

Stable contracts live in tracked source:

```text
.imo/runtime/observability/
  CONTRACT.md
  event.schema.json
  herdr-telemetry.md
```

Generated local state lives only under global project runtime:

```text
~/.imo/projects/<project-id>/runtime/observability/
  events/YYYY-MM-DD.jsonl
```

## Event Contract

Events are append-only JSONL objects. Required fields:

```yaml
schema_version: 1
id: event-id
created_at: timestamp
event_type: stable enum id
trace_id: trace-id
span_id: span-id
plane: command|verify|learning|profile|provider|hook|orchestrate
component: producer id
operation: stable operation id
phase: start|progress|end|skip
outcome: ok|error|timeout|skipped|cancelled
privacy: public|project_private|sensitive
```

Allowed optional fields are compact ids, counts, and categories such as
`parent_span_id`, `duration_ms`, `exit_code`, `error_kind`, `command`,
`check_label`, `status`, `reason`, `count`, `item_count`, `pending_count`,
`source`, and `source_event_type`.

The [Herdr telemetry design](herdr-telemetry.md) profiles this existing envelope
for route decisions, lifecycle delivery, actual parent receipts, intervention,
and successor dispatch. It defines correlation, missing-event audits, latency
budgets, and live-effectiveness checks. A recorded send or successful metrics
command is not proof that the parent received or acted on an event.

## Privacy Boundary

Events must not contain:

- raw user prompts
- full candidate summaries
- source file content
- credentials, tokens, or environment secrets
- full command arguments
- high-cardinality arbitrary file paths

The schema rejects additional properties so direct writers cannot bypass the
compact-field contract.

## CLI Boundary

Current read-only CLI support:

```text
./imo metrics status
./imo metrics summary [--since <duration>] [--json]
./imo metrics timeline --trace <trace-id> [--json]
./imo metrics failures [--since <duration>] [--json]
```

Metrics commands read observability runtime state only and must return clean
empty results when no events exist.

## Safety Controls

- Event write failures must not fail the underlying command.
- Event writes can be disabled with `IMO_DISABLE_EVENTS=1`.
- Local events must never upload or sync by default.
- Runtime activity or telemetry state must not be treated as task completion or
  user consent.
- Verification must emit paired `verify_start`/`verify_end` and
  `verify_check_start`/`verify_check_end` events to the normal resolved project
  runtime.
- Verification fixtures and smoke events must use a temporary runtime and must
  not mutate source `.imo/.runtime` files or pre-existing project runtime state.
