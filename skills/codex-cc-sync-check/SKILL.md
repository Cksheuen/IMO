---
name: codex-cc-sync-check
description: Check whether Codex is currently aligned with Claude Code global configuration, especially shared AGENTS/rules and custom skills under ~/.claude. Use this whenever the user mentions Codex/Claude config sync, AGENTS.md, shared rules, shared skills, global skill visibility, or wants Codex to automatically follow the same Claude configuration from any directory. If alignment is broken, inspect it and repair it by restoring the expected symlink layout.
---

# Codex CC Sync Check

Use this skill to verify that Codex is consuming the same global configuration as Claude Code and to repair the shared-link layout when it drifts.

## What this skill checks

- Shared rules via `~/.claude/shared-knowledge/AGENTS.md`
- Codex global instruction entrypoints:
  - `~/.codex/AGENTS.override.md`
  - `~/.codex/AGENTS.md`
- Custom Claude skills under `~/.claude/skills/`
- Corresponding Codex-visible skill links under `~/.codex/skills/`
- Corresponding direct-invocation command wrappers under `~/.codex/commands/*.md`

## Workflow

1. Read the current state before changing anything.
2. If the user changed a shared governance asset inside a project directory, first decide whether it should be promoted to `~/.claude/`.
3. Promote project-local copies into the global Claude source of truth unless they are explicitly project-only.
4. Run the sync script:

```bash
bash ~/.claude/skills/codex-cc-sync-check/scripts/check_and_align.sh
```

5. Summarize:
   - what was already correct
   - what was repaired
   - any conflicts that were intentionally not overwritten

## Repair rules

- Prefer symlinks over copies so Claude and Codex share one source of truth.
- If a project-local skill/rule/hook was modified but is actually reusable across projects, promote it to `~/.claude/` first and then align Codex to that global source.
- For rules, rely on `~/.claude/hooks/codex-sync/sync-to-codex.sh` when available, because it already compiles and refreshes `~/.claude/shared-knowledge/AGENTS.md`.
- For skills, expose each custom Claude skill to Codex by creating a symlink in `~/.codex/skills/`.
- For direct skill invocation compatibility, create a matching symlink in `~/.codex/commands/<skill-name>.md` pointing at the skill's `SKILL.md`.
- Never overwrite Codex system skills under `~/.codex/skills/.system`.
- Never overwrite a real file in `~/.codex/commands/`; report it as a conflict instead.
- If a target exists as a real directory or file instead of a symlink, treat it as a conflict and report it instead of deleting it blindly.

## Expected output

Report the result in three parts:

### Status

- `aligned` if nothing needed repair
- `repaired` if links were fixed
- `conflicts` if some paths could not be safely aligned

### Checks

- AGENTS status
- Skill link count
- Command wrapper count
- Conflict list, if any

### Actions

- exact links created or corrected
- exact conflicts left unchanged

## Notes

- This skill is specifically for global Codex/Claude alignment, not project-local repository setup.
- Project-local governance edits are temporary staging at most; unless clearly marked project-only, the durable source of truth should live under `~/.claude/`.
- If Codex can "see" a skill but cannot be invoked through the expected direct command entrypoint, inspect `~/.codex/commands/` first.
- A running Codex session does not hot-reload the skill list in its prompt. After repairing links, start a new Codex session to observe newly added skills in the prompt context.
- If the user asks whether Codex can read the config from an arbitrary directory, prefer proving it with a short `codex exec --cd /tmp` validation after alignment.
