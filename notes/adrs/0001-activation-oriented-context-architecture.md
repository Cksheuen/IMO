# ADR 0001: Activation-Oriented Context Architecture

- Status: proposed
- Date: 2026-03-27
- Owners: claude-config maintainers

## Context

The current repository organizes persistent knowledge mostly by **knowledge type**:

- `rules/pattern/`
- `rules/technique/`
- `rules/tool/`
- `rules/knowledge/`
- `skills/<name>/SKILL.md`

This is readable for humans, but weak as a loading model.

The actual problem is not that the tree is flat. The problem is that the tree does not answer the most important runtime question:

**When should this instruction enter context?**

Today, unrelated knowledge can remain effectively “hot” in the same user-level config even when a project will never need it. A frontend AI coding session should not keep carrying backend, ML, Feishu, or browser automation guidance by default.

At the same time, both Claude Code and Trellis have moved toward more explicit scoping:

- Claude Code now documents `.claude/rules/` as a modular rule layer, with unconditional rules for always-on guidance and `paths` frontmatter for conditional loading tied to matching files.
- Claude Code also supports `@imports` in `CLAUDE.md`, which makes profile-style composition a first-class way to load only the right instruction sets.
- Trellis continues to structure specs by project domain (`frontend/`, `backend/`, `guides/`) rather than by abstract knowledge taxonomy.
- Trellis v0.3.1 explicitly fixed initialization/update behavior so spec injection respects `projectType` instead of creating/injecting all frontend/backend directories unconditionally.

These signals point in the same direction:

**Instruction architecture should be organized by activation boundary, not just by topic taxonomy.**

## Decision

Adopt an activation-oriented context architecture with five layers:

1. `core`
   Always-on global guidance that applies to nearly every coding session.
2. `profile`
   Project-type entrypoints such as `frontend`, `backend`, `ml`, `docs`, `agentic-research`.
3. `path-scoped rules`
   Rules that load only when matching files are read.
4. `skills`
   Low-frequency, workflow-heavy, or tool-specific procedures loaded on demand.
5. `notes`
   Research, design rationale, and lessons that support decisions but should not act as always-on instructions.

This means the repository should optimize for the following question order:

1. Is this universally applicable?
2. If not, which project profile owns it?
3. If still too broad, can it be limited by file path?
4. If it is long or procedural, should it be a skill instead?
5. If it is explanatory rather than prescriptive, should it live in notes?

## Consequences

### Positive

- Reduces irrelevant context in projects that only need one domain.
- Aligns repository structure with Claude Code’s actual loading mechanics.
- Aligns better with Trellis’ project-type and spec-domain evolution.
- Makes future additions cheaper: new knowledge must declare an activation boundary.
- Separates “background research” from “runtime instructions”.

### Negative

- Requires a one-time migration and a clearer content governance policy.
- Adds one more concept (`profile`) that maintainers must understand.
- Some existing files will need to be split, not merely moved.

### Risks

- If `core` grows carelessly, the new model collapses back into a hot blob.
- If profiles overlap heavily, users may re-import too much guidance.
- If path rules are too broad, they become pseudo-global.

## Guardrails

- `CLAUDE.md` stays small and only defines the operating kernel.
- Every new rule or skill must declare its activation boundary.
- Domain-specific material must not enter `core` without an explicit exception.
- Research-heavy content should default to `notes/research/` until proven stable.
- Workflow-heavy content should default to `skills/` unless it must always be present.

## Alternatives Considered

### 1. Keep current taxonomy and only freeze low-frequency files

Rejected.

This reduces quantity, but does not fix the structural problem. The repository would still answer “what kind of knowledge is this?” instead of “when should it load?”.

### 2. Keep taxonomy and rely only on manual `@imports`

Rejected.

Imports help, but without a new activation-oriented information architecture, maintainers still have no clear rule for deciding where content belongs.

### 3. Move everything to skills

Rejected.

Skills are appropriate for low-frequency workflows, not for stable coding conventions that should be present while editing matching files.

## Decision Drivers

- Claude Code now has explicit support for modular rules, path-scoped loading, imports, and exclusion of unrelated instruction trees.
- Trellis’ current public docs and local bootstrap continue to separate specs by domain and inject relevant specs instead of one global taxonomy.
- Trellis v0.3.1 shows a clear direction away from generating/injecting non-applicable spec directories.
- The current repository already contains strong signals that this was the intended direction (`context-injection`, `notes/`, `freeze/thaw`) but lacks a consistent activation model.

## Follow-up

The concrete target structure, migration matrix, rollout plan, and acceptance criteria are defined in:

- `notes/design/skills-rules-activation-architecture.md`
