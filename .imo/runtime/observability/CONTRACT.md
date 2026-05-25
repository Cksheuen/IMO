# IMO Observability Runtime Contract

Unified observability is the local runtime visibility layer for IMO-owned
capabilities.

## Scope

Observability covers compact operational facts for:

- command execution
- verification checks
- learning metrics bridge
- profile status visibility
- future orchestrate worker lifecycle events

It does not own Trellis task state, host-output projection, remote telemetry, or
user consent decisions.

## Runtime Storage

Stable contracts live in tracked source:

```text
.imo/runtime/observability/
  CONTRACT.md
  event.schema.json
```

Generated local state lives only under ignored runtime:

```text
.imo/.runtime/observability/
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
- Verification smokes that write observability runtime state must back up and
  restore existing local state.
