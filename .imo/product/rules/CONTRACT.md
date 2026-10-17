# Product Rules Contract

`product/rules/` is reserved for IMO-owned behavioral rules that guide agents
and skills without taking over repository or platform task workflows.

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
  modules; resolve the editable source, fix same-pattern defects within scope,
  and preserve dirty work, stable artifact IDs, and human review state.
- `structured-refactoring`: apply structure as a development standard, keeping
  modules focused during normal changes and using compatibility facades,
  responsibility-based placement, and bounded validation when refactoring
  drifted code. Validate affected behavior without redundant full regressions.
- `focused-context-reading`: search and filter large files, logs, generated
  artifacts, and repository results before loading bounded, traceable slices
  into context.
- `delegated-coding`: choose direct work or bounded delegation; delegated work
  runs through Herdr with `delegate` and the model the user chose. Native
  subagents are not the default or fallback; explicit user/host overrides take
  precedence. Review the real diff and check before calling it done.
- `evidence-first`: when something breaks, inspect the most complete available
  runtime evidence relevant to the failure and sufficient to verify a
  hypothesis (console error, logs, network trace) before forming one; when
  evidence is incomplete, label the hypothesis and its gaps explicitly, and
  never treat an unverified guess as a conclusion or edit code on top of it.
  Completion requires evidence from the actual consumer, with configuration,
  startup, tests, live behavior, and human acceptance reported separately.
- `update-handoff`: keep `.imo/UPDATE.md` synchronized whenever IMO update,
  install, release, runtime-state, hook, or verification mechanics change.
- `identity-veil`: route organization-marking CLIs and identity directories
  exclusively through the local veil by neutral `--task` handles (from
  `veil status`), consume only the graded redacted envelope, and never bypass
  the gate or restate the real name/path it hid.
