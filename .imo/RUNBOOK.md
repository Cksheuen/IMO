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
./imo defensive audit
./imo profile status
./imo learning list
./imo learning signal list
./imo learning candidate list
./imo codex context --empty
./imo verify
bash scripts/imo.sh verify
git diff --check
```

Expected result:

- every command exits `0`
- `./imo audit all` reports zero overlap with Trellis-owned host outputs
- `./imo defensive audit` exits `0`, prints an advisory defensive-programming
  report, and does not mutate source or runtime state
- `./imo learning list` handles missing runtime digest state as a clean empty
  state
- `./imo profile status` handles missing project-profile runtime state as a
  clean missing state and does not create `.imo/.runtime/project-profile/`
- `./imo learning signal list` handles missing runtime signal state as a clean
  empty state
- `./imo learning candidate list` handles missing runtime candidate state as a
  clean empty state
- `./imo verify` checks digest promotion requires review metadata and can
  disable/reset project-scoped digest state
- `./imo codex context --empty` emits valid hook JSON containing
  `<imo-context>` and injects active learning digest entries and project-profile
  summaries when present
- `./imo verify` includes module, learning, project-profile, provider, root
  compatibility, Codex context, defensive audit, compile, and compatibility
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
```

It tells Codex to prefer current repo `.imo/` and `./imo` for IMO-related
questions. It must not override user instructions, parent-agent instructions,
or Trellis workflow state.

The local `.codex/hooks.json` experiment is not a manifest claim. Adapter
manifests remain neutral until a future host-output cutover task explicitly
changes ownership.

## Completion Definition

The direct-run closure is complete when:

1. the acceptance commands pass from the repository root
2. `./imo verify` includes the compatibility-surface checker
3. `.imo/providers/root_surfaces.json` explains every tracked root
   compatibility or external surface
4. `.imo/adapters/*/manifest.json` remains neutral for Trellis-owned host
   outputs
5. no project source-truth requirement depends on `~/.claude/.gitignore`
