# IMO Boundary Model

IMO uses a plane-based architecture. It does not wrap or control Trellis by
default.

## Planes

| Plane | Owner | Primary responsibility | Default relationship |
| --- | --- | --- | --- |
| Trellis Task Plane | Trellis | tasks, PRDs, specs, workflow, Trellis lifecycle | Independent |
| IMO Capability Plane | IMO | repo-owned skills, rules, metrics, feedback, runtime helpers, adapter contracts | Independent |
| IMO Learning Plane | IMO | shared learning signals, candidates, digests, user preference adaptation | Shared read/write layer for public agents |
| External Provider Plane | Provider owner | third-party plugins, downloaded skills, model gateways, external frameworks | Optional integration only |
| Host Output Plane | Host adapter | `.claude/`, `.codex/`, future host-visible projections | Generated output, not source |

## Default Operating Model

Trellis and IMO are independent in normal use:

- Trellis continues to manage task flow.
- IMO manages its own capabilities and learning assets.
- IMO does not proxy Trellis commands by default.
- Trellis does not call IMO by default.
- Optional provider/callback integration is an advanced mode, not the core
  architecture.

This avoids coupling IMO correctness to Trellis internals or Trellis update
behavior.

## IMO Owned Core

The IMO-owned boundary contains assets this repo intends to maintain as IMO
source:

- `.imo/product/`: IMO-owned product capabilities explicitly adopted by this
  repo.
- `.imo/runtime/`: stable runtime contracts, shared helpers, and dependency
  entrypoints.
- `.imo/learning/`: learning schemas, policies, and promotion contracts.
- `.imo/adapters/`: host projection contracts and manifests.
- `.imo/providers/`: optional provider discovery/integration contracts.

High-churn state belongs under `.imo/.runtime/` and must remain rebuildable.

## Trellis Boundary

Trellis stays outside the IMO owned core.

IMO must not implement itself by modifying:

- Trellis source code
- Trellis install directories
- `.trellis/scripts/**`
- `.trellis/workflow.md`
- Trellis-owned generated `.claude/` / `.codex/` host files

If a future task needs Trellis integration, use stable public surfaces only:

- documented Trellis CLI commands
- explicit Trellis configuration hooks
- generated task/spec files as data, not implementation extension points

Those integrations must stay optional and degrade cleanly.

## Learning Boundary

The learning plane prevents each agent ecosystem from adapting to the user in
isolation.

Public agents may:

- read an active learning digest
- write raw learning signals

Only gated IMO learning workflows may:

- promote signals to candidates
- publish active digests
- update hard rules or skill source

Hermes-like self-iteration is a producer of learning candidates, not an
unreviewed writer of active rules.

## External Providers

External providers include:

- Trellis capabilities
- Claude Code or Codex plugins
- downloaded or marketplace skill packs
- model/runtime gateways such as LiteLLM
- local framework runtimes such as LangGraph-based systems

They are not copied into `.imo/product/*` by default. IMO may document how to
discover or call them, but provider source remains owned by the provider.

Adopting an external capability into IMO-owned source requires a dedicated task
that explains why external ownership is insufficient.

## Host Outputs

Host-visible files are generated or projected outputs.

- `.claude/**` and `.codex/**` must not become source-of-truth for IMO.
- Trellis-owned host files must not be claimed by IMO manifests.
- Host adapter writes require ownership checks and dry-run/diff support before
  becoming active.

## Maintenance Guardrails

- Learning items must be inspectable, disableable, and reversible.
- Learning writes must carry source, scope, confidence, TTL, and privacy
  metadata before automated promotion is allowed.
- Active learning digests must carry id, version, scope, `last_updated`, and a
  maximum length before public agents read them by default.
- Provider discovery must be read-only before any invocation is added.
- Provider failures must degrade to "capability unavailable" rather than
  breaking IMO core.
- Module classification must be machine-checkable; do not rely only on README
  prose over time.
- Runtime logs and learning signals must rotate or summarize before they grow
  without bound.
- Trellis independence is a standing regression test: Trellis task flow must not
  require IMO, and IMO native verification must not require Trellis provider
  integration.
