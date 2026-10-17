# IMO Cross-Device Update Handoff

This file is the tracked update handoff for agents that need to refresh IMO on
another device or inside another repository.

## Source Of Truth

- Online repository: `git@github.com:Cksheuen/IMO.git`
- Default branch: `main`
- Current architecture source: `.imo/`
- User entrypoint in a source checkout: `./imo`
- User entrypoint after global install or package link: `imo`

The remote `main` branch was intentionally reset to the new IMO source history
on 2026-05-31. The previous remote `main` is archived at:

```text
archive/old-main-2026-05-31
```

## Update-Method Sync Rule

Every IMO release or migration task must review this file before finishing.
This requirement is also an active product rule:
`.imo/product/rules/update-handoff.md`.

Update this file whenever the task changes any of these surfaces:

- Git remote, default branch, history-reset, archive, or release strategy
- `./imo init`, `./imo update`, `./imo uninstall`, or managed-file behavior
- `./imo global install`, `global migrate`, `global uninstall`, or global shim behavior
- project/global runtime-state layout under `~/.imo/projects/` or `~/.imo/runtime/`
- Codex context hook install, dedupe, or invocation behavior
- identity-veil gate hook, policy schema, or per-host PreToolUse registration
  behavior (`./imo veil install/uninstall`)
- required verification commands for source or installed targets
- manual steps an agent must follow on another device

The project-local Trellis workflow and its host projections were removed after
durable IMO decisions were distilled into `.imo/KNOWLEDGE.md`. Current updates
must not recreate `.trellis/`, Trellis hooks, or the retired task-graph overlay.

If none of the update mechanics changed, no file edit is required, but the
release summary should explicitly say the update method was reviewed and is
unchanged.

## Agent Safety Rules

Agents may automate read-only checks and safe update commands, but must stop and
ask before destructive or history-rewriting actions.

Do not run these automatically when local changes exist:

```bash
git reset --hard
git clean -fd
./imo update <target> --force
./imo uninstall <target> --force
git push --force
```

Never delete runtime state as part of a normal update:

```text
~/.imo/runtime/**
~/.imo/projects/**
```

Global user profile state is portable user data, not project source. It should
be moved only through explicit profile export/import commands.

## Minimal Source Checkout Update

Use this when the other device has an IMO source checkout.

### 1. Preflight

```bash
cd /path/to/IMO
git remote -v
git status --short
git branch --show-current
git ls-remote --heads origin main
```

If `git status --short` is not empty, stop and report the dirty paths. Do not
reset or overwrite.

### Runtime Prerequisites

Native IMO CLI commands and verification use the Python standard library.
No virtual environment or third-party Python dependencies are required.

### 2. Clean Update

For a clean checkout:

```bash
git fetch origin --prune
git switch main
git reset --hard origin/main
./imo verify
```

`git reset --hard origin/main` is acceptable only after the preflight confirms a
clean worktree. It is required for old devices that still have the pre-reset IMO
history.

### 3. Global Shim Refresh

After the source checkout verifies, refresh the global runtime and Codex lazy
projections:

```bash
./imo global status
./imo global install --apply
imo global status
```

`global install --apply` also establishes Codex host ownership under
`~/.imo/install/codex/`: `AGENTS.md` is rendered by IMO and linked from
`~/.codex/AGENTS.md`, while `ownership.json` records the managed Codex
surfaces. Do not use `--force` for an unrelated unmanaged Codex `AGENTS.md`;
review that path first.

If `global install` reports an unmanaged shim conflict, stop and report it. Use
`--force` only after the user explicitly approves replacing the unmanaged file.

Before `--apply`, `./imo global install` performs the same unmanaged-conflict
and hooks JSON preflight without writes. After apply, run
`imo global doctor --json`; a nonzero exit or any `missing`, `modified`,
`stale`, or `conflict` state means stop and inspect the reported surface.

## Icarus

Icarus now lives in its own repository: https://github.com/Cksheuen/icarus.
IMO no longer bundles it. Install it from that repository as described in its README.

## Consumer Projects

Consumer projects require no framework installation. IMO resolves a project
from a project-local `.imo` marker, the nearest Git root, or a
`global-zero-install` registration under `~/.imo/projects/*/project.json`.
When several candidates match, the deepest one wins; if a local marker and a
registration are equally deep, the local marker wins. Project state always
lives under `~/.imo/projects/<project-id>/runtime/`.

An ordinary Git repository needs no registration. A non-Git workspace root
such as `/Users/bytedance/Documents/Projects/latam-c` must be registered once,
which still reports `repository files written: 0` and writes state only to
`~/.imo/projects`:

```bash
imo init /path/to/target-repo
```

This change does not alter the cross-machine update flow: after fetching or
updating the source checkout, `./imo verify` is sufficient and `global install`
does not need to be re-run (unless `imo global status` itself asks for it).

For a repository that still contains an old direct-run profile, preview and
remove only hash-matched managed files after global install succeeds:

```bash
imo uninstall /path/to/target-repo --dry-run
imo uninstall /path/to/target-repo
```

Normal uninstall preserves runtime knowledge under `~/.imo/projects/`. Use
`--force` only after reviewing reported modified legacy files.

Verify from the target repository:

```bash
imo global status
imo codex context --empty --stats
```

## Identity Veil On Another Device

The veil never installs with `global install`. On a device that wants the
host-enforced black box:

```bash
./imo veil selftest
./imo veil register            # interactive, in your own terminal; maps a real CLI to a handle
./imo veil install --apply --host both   # dry run without --apply
./imo veil status
```

`register` is TTY-only and reads the real command/path without echoing it into
an agent conversation; it assigns a neutral `org-cli-N`/`org-config-N` handle.
After registering, run that tool's `--help` once yourself and add any
organization words still visible in its output to the local policy patterns
(or set the handle to `opaque`).

This projects `veil-gate.sh` and `veil-context.sh` under `~/.imo/hooks/` and
adds a `PreToolUse` gate plus a `SessionStart` handle announcement to
`~/.claude/settings.json` and `~/.codex/hooks.json`, keeping a manifest under
`~/.imo/install/identity-veil/`. Use `--gate-only` to skip the announcement.
Uninstall with `./imo veil uninstall --apply`; third-party hooks and the
standard Codex context hook are preserved. Verify the gate denies a marked
call (exit 2), allows an ordinary command (exit 0), and `veil context` lists
only neutral handles.

The real command/path mapping lives only in
`~/.imo/runtime/identity-veil/policy.json`, which is machine-local by design
so tracked source stays free of organization identifiers. It is not synced
through git; on each device run `./imo veil policy init`, replace the example
placeholders with that device's real mapping, then verify with
`./imo veil status`.

## First Install On A New Device

```bash
git clone git@github.com:Cksheuen/IMO.git
cd IMO
./imo verify
./imo global install --apply
imo global status
```

## Decision Matrix

| Situation | Action |
| --- | --- |
| New device, no IMO checkout | clone, verify, global install |
| Existing clean IMO checkout | fetch, switch main, reset to origin/main, verify |
| Existing dirty IMO checkout | stop and report dirty paths |
| Any normal consumer project | no install; run global `imo` from the project |
| Legacy target with hash-matched managed files | `imo uninstall <target>` after dry-run |
| Legacy target with modified managed files | report; ask before `--force` |
| Global shim conflict | report unmanaged path; ask before `--force` |
| Need old online history | inspect `archive/old-main-2026-05-31` |

## Release Gates

```bash
python3 .imo/product/scripts/check_tracked_references.py --require-tracked --json
./imo verify
npm pack --dry-run
```

## Completion Checklist

- [ ] Source checkout points at `git@github.com:Cksheuen/IMO.git`
- [ ] Source checkout is on `main`
- [ ] Source checkout matches `origin/main`
- [ ] `./imo verify` passes in the source checkout
- [ ] Strict tracked-reference validation is clean
- [ ] `imo global status` reports the expected global root
- [ ] `imo global status` reports the Codex hook, IMO-owned instructions, and all expected skill projections
- [ ] `imo global doctor --json` is healthy and all six states are `present`
- [ ] Verify lifecycle events are paired and source `.imo/.runtime` is unchanged
- [ ] Consumer repositories contain no IMO framework copy
- [ ] Runtime state under `~/.imo/projects/**` and `~/.imo/runtime/**` was not deleted
