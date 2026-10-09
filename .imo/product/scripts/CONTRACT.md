# Product Scripts Contract

`product/scripts/` is the canonical implementation surface behind root `./imo`.

## Boundaries

- Root wrappers delegate; they do not duplicate dispatch or business logic.
- `install.py` registers projects in global state without repository writes and
  retains a hash-guarded cleanup path for legacy direct-run profiles.
- `global_config.py` manages the global context hook, exact Codex hook entry,
  and lazy canonical skill symlinks; mutations require explicit `--apply`.
  `global_codex_instructions.py` owns a marked IMO block inside the projected
  Codex `AGENTS.md`, preserving user content outside the block. The ownership
  marker records which Codex host surfaces are managed by IMO and prevents
  unmanaged overwrite.
- `global_config.py` `status`/`doctor` explicitly report `present`, `missing`,
  `modified`, `stale`, and `conflict`; install without `--apply` performs the
  same conflict preflight without writing.
- `codex_context.py` emits advisory context capped at `1200 / 2200 / 4000`
  characters for compact, standard, and full modes.
- `project_profile.py` refreshes cached conventions only on explicit command.
- `identity_veil.py` is the opt-in identity black box: it classifies marked
  commands/files, executes or reads them locally, and emits graded
  `clear`/`sanitize`/`opaque` envelopes that never carry argv or opaque bytes.
  Its `gate` subcommand implements the shared PreToolUse deny protocol;
  install/uninstall manage one bounded per-host registration with a dedicated
  manifest and never run under default `global install`.
- `learning.py` is a compatibility facade over `learning_common.py`,
  `learning_signals.py`, `learning_candidates.py`, `learning_digest.py`,
  `learning_profile.py`, and `learning_review.py`.
- `learning_events.py`, `observability_events.py`, and `metrics.py` keep source,
  reviewed state, and compact telemetry separate.
- `budget_audit.py` and `defensive_audit.py` are read-only advisory reports.
- Provider, rule, module, learning, profile, identity-veil, observability,
  and root-surface checkers validate stable machine-readable contracts.
- `check_skill_semantics.py` and `check_tracked_references.py` make skill
  classifications and release inputs machine-checkable. Semantic provider
  health excludes dated example paths and optional JSONL runtime data while
  still reporting them as non-required references.

## Verification

`./imo verify` combines syntax and contract checks with real command smokes. It
emits top-level and per-check lifecycle events, uses one temporary runtime for
fixtures, and never treats source `.imo/.runtime` as a fixture. It must avoid
recursion and keep optional provider absence non-fatal. The strict tracked
checker is the CI/release gate; default mode reports untracked files without
failing a local dirty worktree.

Read-only commands must not create missing runtime state. Best-effort learning
or observability event writes may be disabled with the documented environment
flags and must never turn a successful operation into failure.

Lifecycle smoke coverage must exercise zero-install project registration,
global hook/skill projection, legacy cleanup, and runtime preservation.
