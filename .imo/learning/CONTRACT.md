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
  schemas/
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

| Level | Description | Writer | Promotion gate |
| --- | --- | --- | --- |
| Raw signal | Single correction, failure, preference hint, or behavior observation | Any public agent | None |
| Candidate | Aggregated or high-value lesson proposal | IMO learning workflow or Hermes-like loop | Required before digest |
| Active digest | Short behavior guidance read by public agents | IMO learning workflow | Required |
| Hard rule / skill update | Long-lived rule, skill, or source change | Explicit task/review | Required |

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
- Hermes-like self-iteration may propose candidates but must not directly change
  active rules or skill source.
- Conflicting candidates must remain unresolved until reviewed or enough
  evidence separates them.

## Required User Controls

Future CLI support should include:

```text
imo learning list
imo learning inspect <id>
imo learning disable <id>
imo learning reject <id>
imo learning promote <id>
imo learning reset --scope project|global
```

These controls must exist before automated learning promotion becomes the
default path.
