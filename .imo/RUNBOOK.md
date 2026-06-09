# IMO Direct-Run Acceptance Runbook

This runbook is the final acceptance sequence for proving that IMO runs from
the current repository path with `.imo/` as the source of truth.

## Scope

- IMO product source: `.imo/product/**`
- IMO runtime contracts: `.imo/runtime/**`
- IMO learning contracts: `.imo/learning/**`
- IMO provider and compatibility contracts: `.imo/providers/**`
- Primary user entrypoint: `./imo`
- Compatibility entrypoint: `scripts/imo.sh`

This runbook does not claim `.claude/` or `.codex/` host-output ownership.
Trellis remains the task plane and the owner of Trellis host-output projection
in the current repo state.

## Acceptance Commands

Run from the repository root:

```bash
./imo --help
./imo audit all
./imo budget audit
./imo defensive audit
./imo profile status
./imo learning list
./imo learning signal list
./imo learning candidate list
./imo learning activity status
./imo learning review inbox
./imo learning profile status
./imo learning profile inspect
./imo learning metrics summary
./imo metrics status
./imo metrics summary
./imo metrics failures
./imo global status
IMO_GLOBAL_ROOT=/tmp/imo-global-smoke ./imo global install --apply
IMO_GLOBAL_ROOT=/tmp/imo-global-smoke ./imo learning list --scope global
IMO_GLOBAL_ROOT=/tmp/imo-global-smoke ./imo learning list --scope merged
npm_config_cache=/private/tmp/imo-npm-cache npm pack --dry-run
node bin/imo.js --help
./imo init /tmp/imo-smoke-target
/tmp/imo-smoke-target/imo verify
./imo update /tmp/imo-smoke-target
./imo uninstall /tmp/imo-smoke-target --force
./imo codex context --empty
./imo codex context --empty --stats
IMO_CONTEXT_MODE=compact ./imo codex context --empty --stats
./imo codex context --empty --mode full --stats
./imo task graph
./imo task graph --json
./imo task graph show 05-22-imo-task-graph-references
./imo task graph plan
./imo verify
bash scripts/imo.sh verify
git diff --check
```

Expected result:

- every command exits `0`
- `./imo audit all` reports zero overlap with Trellis-owned host outputs
- `./imo budget audit` exits `0`, reports visible local context slices,
  ownership-aware Trellis/IMO/project labels, and threshold-based IMO-facing
  follow-up suggestions, and does not mutate source or runtime state
- `./imo defensive audit` exits `0`, prints an advisory defensive-programming
  report, and does not mutate source or runtime state
- `./imo learning list` handles missing runtime digest state as a clean empty
  state
- `./imo learning list --scope project|global|merged` reads the requested
  project, global, or merged digest state without creating runtime files
- `./imo profile status` handles missing project-profile runtime state as a
  clean missing state and does not create `.imo/.runtime/project-profile/`
- `./imo task graph`, `show`, and `plan` inspect current-project
  `.trellis/tasks/*` as external source objects, do not mutate Trellis task JSON,
  and do not create
  `.imo/.runtime/task-graph/`
- `./imo task graph run <task-id-or-dir>` refuses before execution when explicit
  `files_to_modify` ownership or dependency gates are missing; successful runs
  may write summaries only under the current project's
  `.imo/.runtime/task-graph/runs/`
- `./imo learning signal list` handles missing runtime signal state as a clean
  empty state
- `./imo learning candidate list` handles missing runtime candidate state as a
  clean empty state
- `./imo learning activity status` handles missing session activity state as a
  clean empty state and does not create `.imo/.runtime/session/`
- `./imo learning review inbox` handles missing candidate state as a clean empty
  state and never creates active digest state
- `./imo learning profile status` and `./imo learning profile inspect` handle
  missing global user profile state as clean missing output and do not create
  `~/.imo/runtime/learning/user-profile.json`
- `./imo learning metrics summary` handles missing event state as a clean zero
  summary and does not create `.imo/.runtime/learning/`
- `./imo metrics status`, `./imo metrics summary`, and `./imo metrics failures`
  handle missing observability runtime state as clean empty output and do not
  create `.imo/.runtime/observability/`
- `./imo global status` is read-only, reports the global IMO root and current
  project root, and does not modify host settings
- `./imo global install --apply` writes only managed shim files under the
  selected global root, refuses unmanaged shim conflicts unless `--force` is
  explicit, does not create global task graph runtime, and installs a Codex
  context hook that skips execution when a project already declares a local IMO
  context hook
- `node bin/imo.js --help` reaches the same root `./imo` command surface
- `npm pack --dry-run` succeeds and includes the package bin, root `imo`, and
  IMO direct-run source assets needed by the local package wrapper
- `./imo init <target>` installs the direct-run profile into a target
  repository: `.imo/`, root `imo`, root compatibility `scripts/` and `skills/`,
  `.gitignore` whitelist markers, and `.imo/.runtime/install/managed-hashes.json`
- the installed target can run `<target>/imo verify`
- `./imo update <target>` refreshes unchanged managed files, preserves
  user-modified managed files by default, and does not touch
  `.imo/.runtime/**`; `--strict` refuses on local managed-file edits, and
  `--force` overwrites them
- `./imo uninstall <target>` removes unchanged managed files and keeps
  user-modified files unless `--force` is explicit
- `./imo verify` checks digest promotion requires review metadata and can
  disable/reset project-scoped digest state
- `./imo codex context --empty` emits valid hook JSON containing
  `<imo-context>` and injects enabled user-profile guidance, active learning
  digest entries, and project-profile summaries when present
- `./imo codex context --empty --stats` emits read-only JSON showing the
  default `standard` context stays within the 2200 character budget; compact
  mode stays within 1200 characters, and full mode stays within 4000 characters
- `./imo verify` includes module, learning, observability, project-profile,
  provider, root compatibility, package wrapper, global/project scope, Codex
  context, defensive audit, learning telemetry, compile, and compatibility
  import checks
- `bash scripts/imo.sh verify` remains a compatibility form of the aggregate
  check

Known environment note: the Python runtime may print a LibreSSL warning from
`urllib3`; the runbook result is determined by command exit codes.

## Source-Truth Checks

- Root `./imo` is a thin wrapper into `.imo/product/scripts/imo.sh`.
- Root `scripts/` entries are declared in `.imo/providers/root_surfaces.json`
  and validated as compatibility wrappers.
- Root `skills/` entries are one of:
  - symlink projections into `.imo/product/skills/**`
  - symlink projections into `.imo/runtime/**`
  - explicitly declared external provider surfaces
- `.gitignore` may keep `scripts/**` and `skills/**` whitelisted only because
  those roots are audited compatibility or external-provider surfaces.
- Installed target `.gitignore` files receive an IMO managed block containing
  only the direct-run profile whitelist patterns.
- Root `package.json` exposes only a thin local package link wrapper; it must
  not become a second implementation of IMO command behavior.

## External Skill Boundary

The current non-IMO root skill surfaces are declared external provider
surfaces:

- `skills/pencil-design`
- `skills/impeccable`
- `skills/xmind`

They must not be copied into `.imo/product/skills/**` unless a future adoption
task explicitly changes ownership and updates module metadata.

## Codex Context Experiment

Current local Codex context injection is intentionally lightweight:

```bash
./imo codex context
./imo codex context --stats
```

It tells Codex to prefer current repo `.imo/` and `./imo` for IMO-related
questions. It must not override user instructions, parent-agent instructions,
or Trellis workflow state. The default `standard` mode is capped at 2200
characters; `compact` is capped at 1200 characters; `full` is capped at 4000
characters.

The local `.codex/hooks.json` experiment is not a manifest claim. Adapter
manifests remain neutral until a future host-output cutover task explicitly
changes ownership.

## Completion Definition

The direct-run closure is complete when:

1. the acceptance commands pass from the repository root
2. `./imo verify` includes the compatibility-surface checker
3. `./imo verify` includes the package-wrapper smoke
4. `./imo verify` includes the install lifecycle smoke
5. `.imo/providers/root_surfaces.json` explains every tracked root
   compatibility or external surface
6. `.imo/adapters/*/manifest.json` remains neutral for Trellis-owned host
   outputs
7. no project source-truth requirement depends on `~/.claude/.gitignore`
