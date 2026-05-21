# IMO Learning Plane Contract

The learning plane is the shared user-adaptation layer for IMO-owned
capabilities and public agents.

## Scope

The learning plane manages:

- user preferences
- correction signals
- recurring failure patterns
- lesson candidates
- Hermes-like self-iteration outputs
- active learning digests consumed by agents

It does not own Trellis tasks, provider source, or host-generated files.

## Storage Boundaries

Durable protocol and policy:

```text
.imo/learning/
  CONTRACT.md
  policy.json
  schemas/
    signal.schema.json
    candidate.schema.json
    digest.schema.json
  policies/
```

Project-local runtime state:

```text
.imo/.runtime/learning/
  signals.jsonl
  candidates.jsonl
  digest.json
```

Optional global user state:

```text
~/.imo/learning/
  user-preferences.json
  global-lessons.jsonl
  agent-digests/
```

Runtime state must be inspectable and rebuildable where possible. Global state
must never be committed.

## Learning Levels

The machine-readable policy is `.imo/learning/policy.json`. The aggregate
verification command validates it through
`.imo/product/scripts/check_learning_contracts.py`.

| Level | Description | Writer | Promotion gate |
| --- | --- | --- | --- |
| Raw signal | Single correction, failure, preference hint, or behavior observation | Any public agent | None |
| Candidate | Aggregated or high-value lesson proposal | IMO learning workflow or Hermes-like loop | Required before digest |
| Active digest | Short behavior guidance read by public agents | IMO learning workflow | Required |
| Hard rule / skill update | Long-lived rule, skill, or source change | Explicit task/review | Required |

## Required Fields

Raw signals should include:

```yaml
id: signal-id
created_at: timestamp
source_agent: agent-or-skill-id
scope: session|task|project|global
privacy: public|project-private|sensitive
confidence: low|medium|high
ttl: duration-or-null
summary: short text
evidence_ref: optional pointer
```

Active digest items should include:

```yaml
id: digest-item-id
digest_version: version
scope: project|global
last_updated: timestamp
status: active|disabled
priority: normal|high
rollback_id: rollback reference
summary: short instruction
source_candidates:
  - candidate-id
```

These fields are required before public agents consume the digest by default.

## Public Agent Contract

Public agents may:

- read active learning digests
- write raw learning signals

Public agents must not:

- directly edit active digests
- directly promote hard rules
- rewrite IMO skill source based only on a raw signal
- write provider source as a learning side effect

Public agents include:

- Trellis implement/check/research agents
- Claude Code main agents
- Codex main/review agents
- IMO native skills
- Hermes-like self-iteration agents
- dual-review-loop
- orchestrate
- multi-model-agent

## Promotion Policy

Promotion must preserve traceability:

- every raw signal has source, scope, confidence, TTL, and privacy metadata
- every candidate references source signals
- every active digest item has an id
- every hard rule/skill update references a task or review decision
- every promoted item can be disabled or rolled back

Priority order:

```text
current explicit user instruction
> current project rules
> active learning digest
> candidate lessons
> raw signals
```

## Safety Controls

- Raw signals should have low default weight.
- Temporary preferences should expire unless repeated or confirmed.
- Global learning must avoid project-private details.
- Ambiguous privacy scope defaults to project-local.
- Dedupe should run before candidate generation.
- Digest generation should enforce max length and scope filtering.
- Hermes-like self-iteration may propose candidates but must not directly change
  active rules or skill source.
- Conflicting candidates must remain unresolved until reviewed or enough
  evidence separates them.

## Digest Quality Rubric

An active digest item should be:

- scoped: explicitly session, task, project, or global
- current: not contradicted by newer user instructions
- evidence-backed: linked to signals, candidates, or review decision
- actionable: tells an agent what to do differently
- compact: short enough for repeated context injection
- reversible: disable and rollback path exists
- non-secret: global items contain no project-private facts

Digest items that fail the rubric should remain candidates.

## Privacy Classification

Global learning may store stable user-level patterns:

- communication preferences
- workflow preferences
- tool-use preferences that are not project-specific

Global learning must not store:

- project paths
- sensitive project names
- business logic or implementation facts
- customer/domain data
- credentials, tokens, or environment-specific secrets

When classification is unclear, keep the item project-local.

The policy uses `project_private` as the machine-readable id for the
`project-private` privacy class.

## User Controls

Current read-only CLI support:

```text
imo learning list
imo learning inspect <id>
```

These commands read `.imo/.runtime/learning/digest.json` when present. They must
not create runtime files or mutate learning state.

Current raw signal CLI support:

```text
imo learning signal list
imo learning signal add --summary <text>
```

`signal list` reads `.imo/.runtime/learning/signals.jsonl` when present and
must not create runtime files. `signal add` appends a raw signal only; it must
not create candidates, active digests, hard rules, skill changes, provider
changes, or host-output changes.

Current candidate CLI support:

```text
imo learning candidate build
imo learning candidate list
imo learning candidate inspect <id>
imo learning candidate reject <id> --reason <text>
```

Candidate commands read raw signals and write
`.imo/.runtime/learning/candidates.jsonl` only. They must not mutate active
digest state.

Future write/control CLI support should include:

```text
imo learning digest disable <id> --reason <text>
imo learning candidate reject <id> --reason <text>
imo learning digest promote <candidate-id> --review-ref <ref> --rollback-id <id>
imo learning digest reset --scope project|global
```

These controls must exist before automated learning promotion becomes the
default path.

The current digest control implementation supports these commands, but it still
requires explicit review metadata and does not promote hard rules or skill
source.
