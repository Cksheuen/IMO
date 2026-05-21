# Product Rules Contract

`product/rules/` is reserved for IMO-owned behavioral rules that guide agents
and skills without taking over Trellis task flow.

## Contract

- Rules here are IMO capability-plane source assets.
- Rules must be explicit enough for agents to apply during implementation.
- Rules must not be host-output files and must not require projection into
  `.claude/` or `.codex/` to be valid.
- Each active rule must have machine-readable metadata in `rules.json`.
- `./imo verify` validates rule metadata and required rule-document sections.

## Inclusion Rule

- Add rules here when they express reusable IMO behavior across projects or
  mature codebases.
- Do not use this surface for project-private facts, transient task decisions,
  or host adapter wiring.
- If a rule comes from learning, promote it through a reviewed task before
  adding or updating this source.

## Current Rules

- `chameleon`: adapt to established project conventions before coding new
  modules, and override generic agent habits that conflict with local evidence.
