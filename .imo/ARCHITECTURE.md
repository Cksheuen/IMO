# IMO Architecture

IMO has three durable layers:

1. `product/`: canonical commands, rules, and on-demand skills.
2. `runtime/`: versioned contracts, schemas, and shared helpers.
3. `learning/`: reviewed user-adaptation policy and data contracts.

Global `~/.imo/runtime/` contains user-level state. Project-scoped profiles,
learning state, observability events, and caches live under
`~/.imo/projects/<project-id>/runtime/`, outside application repositories.

## Source and projection

- `.imo/` in the IMO source checkout is canonical.
- Root `imo`, `scripts/`, and `skills/` are source-checkout compatibility
  surfaces only; they are not copied into consumer projects.
- `imo global install --apply` registers a bounded Codex hook and projects
  enabled skills into `~/.codex/skills/` as symlinks to canonical source.
- External plugins, skills, and runtimes stay direct-use providers by default;
  discovery is read-only and invocation is opt-in.

## Context path

`imo codex context` emits a compact advisory router. It reads cached project
and reviewed learning summaries, never scans the repository or refreshes state
at prompt time, and stays within mode budgets. Detailed contracts and skills
are loaded on demand through `KNOWLEDGE.md` and skill entrypoints.

## Safety path

`imo init` and `update` write project registration only under `~/.imo/projects/`.
They write no framework files into a consumer repository. `imo uninstall`
retains a compatibility cleanup path for old managed direct-run profiles and
never removes global or project runtime knowledge by default.

The identity veil is an independent, opt-in safety path. `imo veil install
--apply` projects a generated PreToolUse gate hook and, by default, a
SessionStart context hook under `~/.imo/hooks/`, registering each per chosen
host (`~/.claude/settings.json`, `~/.codex/hooks.json`) without touching
foreign registrations. The context hook announces neutral tool handles so a
session never needs to emit a real command name; `--gate-only` omits it. The
veil keeps a dedicated manifest under `~/.imo/install/identity-veil/`, is
never part of default `global install`, and is fully removed by
`imo veil uninstall --apply`. The gate redirects identity-marked calls and
files to `imo veil run`/`imo veil read`, which return only graded redacted
envelopes addressed by neutral handles; the veil never logs argv or raw output.
