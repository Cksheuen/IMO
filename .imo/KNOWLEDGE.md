# IMO Stable Knowledge

This file preserves durable decisions that were previously scattered across
the retired project workflow/spec system. It is an on-demand index, not
prompt-time context. Load only the contract relevant to the current change.

## Source Priority

```text
explicit user instruction
> tracked IMO contracts and schemas
> current local source and tests
> cached project profile
> enabled user profile
> reviewed learning digest
> generic model defaults
```

Canonical implementation and contract truth lives under `.imo/`. Root
`imo`, `scripts/`, and `skills/` are compatibility or provider surfaces only.
They must not become a second editable implementation source.

## Contract Router

| Change surface | Read first | Stable decision |
| --- | --- | --- |
| product scripts or skills | `.imo/product/README.md` and the local `CONTRACT.md` | canonical implementation stays under `.imo/product/` |
| shared runtime helpers | `.imo/runtime/CONTRACT.md` | shared runtime truth stays under `.imo/runtime/`; root paths are projections only |
| install or update | `.imo/UPDATE.md` | global-first install, zero project files, and runtime preservation |
| behavioral rules | `.imo/product/rules/CONTRACT.md` | every active rule has machine-readable metadata and a contract check |
| learning or user profile | `.imo/learning/CONTRACT.md` | signals, candidates, reviewed digest, and hard updates remain separate levels |
| project profile | `.imo/runtime/project-profile/CONTRACT.md` | refresh is explicit; prompt-time reads never scan or mutate the repo |
| observability | `.imo/runtime/observability/CONTRACT.md` | events are local, compact, privacy-safe, and non-blocking |
| identity veil | `.imo/runtime/identity-veil/CONTRACT.md` | marked CLIs/files run only behind the local veil; graded envelopes never leak argv or raw identity content |
| defensive audit | `.imo/runtime/defensive-audit/CONTRACT.md` | advisory findings never rewrite source automatically |
| prompt context | `.imo/product/scripts/codex_context.py` | context is bounded and informational; details load on demand |
| verification | `.imo/RUNBOOK.md` | source, manifests, and runtime state must remain unchanged after read-only checks |

## Stable Runtime Decisions

### Canonical source and compatibility

- `.imo/product/*` owns adopted product scripts, rules, and skills.
- `.imo/runtime/*` owns shared schemas, contracts, and reusable runtime helpers.
- Root wrappers must forward to an explicitly declared canonical target.
- Root skill/runtime compatibility files must be symlink projections or
  declared external-provider surfaces.
- Moving canonical source does not justify unrelated caller rewrites.

### Lossless lifecycle

- `imo init` and `imo update` register projects globally without repository
  framework files.
- `imo uninstall` uses old managed hashes only to clean legacy direct-run files.
- Operational state under `~/.imo/runtime/**` and
  `~/.imo/projects/<project-id>/runtime/**` is preserved by normal uninstall.

### Rules and local evidence

- Active rules require an id, owner surface, trigger, bounded context summary,
  priority order, and contract validation.
- Local neighboring code, tests, and repository rules outrank generic model
  habits.
- Extra validation, abstraction, fallbacks, or broad rewrites require concrete
  local evidence or correctness risk.

### Bounded lazy context

- Prompt-time context is a small router, not a knowledge dump.
- Hard character budgets remain `compact <= 1200`, `standard <= 2200`, and
  `full <= 4000` until representative evaluations justify a change.
- Prompt-time code may read validated cached summaries and reviewed digests;
  it must not scan the repository, refresh profiles, build candidates, or
  mutate source.
- Large skills, contracts, and reference documents load only after their
  trigger matches the current task.
- Context changes must be measured with stats and evaluated for duplication,
  instruction conflicts, and repeated per-turn cost.

### Learning and user adaptation

- Raw signals are low-trust observations and are not injected by default.
- Candidates aggregate evidence but cannot directly modify active guidance.
- Active digest and hard rule/skill updates require explicit review and
  rollback metadata.
- Background work may prepare candidates only; runtime activity is not user
  consent or task-completion proof.
- Global user profiles contain person-level communication/workflow preferences,
  never project paths, business logic, credentials, or private implementation
  facts.
- Missing, disabled, invalid, or ambiguous global data degrades to no injected
  profile; ambiguous privacy remains project-local.

### Local observability

- Events contain stable ids, low-cardinality states, counts, durations, and
  error kinds only.
- Events never contain raw prompts, full arguments, candidate bodies, source
  content, credentials, or arbitrary high-cardinality paths.
- Event write failure never fails the underlying command.
- Metrics reads are read-only and return a clean empty state when runtime data
  is absent.
- Telemetry measures operation; it is not evidence of user consent or learning
  effectiveness by itself.

### Identity veil

- Identity-marked commands and files are addressed by neutral handles through
  a local veil; the model sees only `clear`/`sanitize`/`opaque` envelopes and a
  SessionStart handle announcement, never the argv, working directory, real
  name/path, or opaque bytes. Tools are mapped to handles interactively with
  `imo veil register`; tracked source carries no organization identifiers.
- The PreToolUse gate is strictly opt-in via `./imo veil install --apply`,
  manages bounded per-host registrations, keeps a dedicated manifest, and
  never rides the default `global install`.
- The gate fails open and records state through `./imo veil status`; it never
  logs argv or raw output, and it does not cover MCP tools.

### Current execution routing

- Pure explanation, planning, and bounded reads remain in the main session;
  small bounded implementation fixes may use one Herdr worker by default, and
  larger independent work may be split. Every lifecycle change must return to
  the coordinator; an explicit worker route must verify the effective route and
  must not silently fall back.
- The learning plane currently prepares candidates and waits for explicit
  review. It has no autonomous promotion actor, so prose about a separate
  self-iteration agent is historical context rather than a runtime capability.

### Verification

- Contract checks use tracked schemas and standard-library parsing where
  practical.
- Verification compiles into a temporary cache and does not generate or
  project host files.
- Runtime-writing smokes back up and restore pre-existing ignored state.
- User-facing wrappers, install/update preservation, package forwarding,
  learning policy, rules, modules, profiles, observability, and providers each
  retain a focused contract check.
- A check is complete only when it exits cleanly and leaves the worktree and
  protected runtime state unchanged.

## Retired Architecture

The project-specific task framework, workflow state machine, host projections,
and task-graph overlay were removed after their stable decisions were distilled
here and into the contracts above. Historical task artifacts remain available
through prior local backups or repository/session history; they are not active
product truth and must not be reintroduced as prompt-time context.
