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
- project/global runtime-state layout under `.imo/.runtime/` or `~/.imo/runtime/`
- Codex context hook install, dedupe, or invocation behavior
- required verification commands for source or installed targets
- manual steps an agent must follow on another device

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
.imo/.runtime/**
~/.imo/runtime/**
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

After the source checkout verifies:

```bash
./imo global status
./imo global install --apply
imo global status
```

If `global install` reports an unmanaged shim conflict, stop and report it. Use
`--force` only after the user explicitly approves replacing the unmanaged file.

## Project Direct-Run Profile Update

Use this when another repository already has an IMO direct-run profile.

Run from the IMO source checkout:

```bash
./imo update /path/to/target-repo
```

Default `update` behavior is the safe path:

- refreshes managed files that are unchanged
- preserves user-modified managed files
- leaves `.imo/.runtime/**` untouched

For supervision:

```bash
./imo update /path/to/target-repo --strict
```

Use `--strict` when the agent should refuse if the target has local edits.
Use `--force` only after reviewing the dirty-path report with the user.

Verify the target after update:

```bash
/path/to/target-repo/imo verify
/path/to/target-repo/imo codex context --empty --stats
```

## First Install On A New Device

```bash
git clone git@github.com:Cksheuen/IMO.git
cd IMO
./imo verify
./imo global install --apply
imo global status
```

For a project that should receive the direct-run profile:

```bash
./imo init /path/to/target-repo
/path/to/target-repo/imo verify
```

## Decision Matrix

| Situation | Action |
| --- | --- |
| New device, no IMO checkout | clone, verify, global install |
| Existing clean IMO checkout | fetch, switch main, reset to origin/main, verify |
| Existing dirty IMO checkout | stop and report dirty paths |
| Existing target project with clean managed files | `./imo update <target>` |
| Existing target project with local managed-file edits | report; use `--strict` or ask before `--force` |
| Global shim conflict | report unmanaged path; ask before `--force` |
| Need old online history | inspect `archive/old-main-2026-05-31` |

## Completion Checklist

- [ ] Source checkout points at `git@github.com:Cksheuen/IMO.git`
- [ ] Source checkout is on `main`
- [ ] Source checkout matches `origin/main`
- [ ] `./imo verify` passes in the source checkout
- [ ] `imo global status` reports the expected global root
- [ ] Each updated target repo passes `<target>/imo verify`
- [ ] Runtime state under `.imo/.runtime/**` and `~/.imo/runtime/**` was not deleted
