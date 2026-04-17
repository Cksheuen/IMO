---
name: codex-cc-sync-check
description: Check whether Codex is currently aligned with Claude Code global configuration, especially shared AGENTS/rules and custom skills under ~/.claude. Use this whenever the user mentions Codex/Claude config sync, AGENTS.md, shared rules, shared skills, global skill visibility, or wants Codex to automatically follow the same Claude configuration from any directory. If alignment is broken, inspect it and repair it by restoring the expected symlink layout.
description_zh: "检查 Codex 是否与 Claude Code 的全局配置保持对齐，重点覆盖 ~/.claude 下共享的 AGENTS、rules、skills 与 commands manifest；当用户提到 Codex/Claude 配置同步、AGENTS.md、共享规则、共享技能、共享命令或全局可见性时使用。若发现失配，先基于 manifest 输出结构化 drift report，再决定是否进入修复。"
---

# Codex CC Sync Check

Use this skill to verify that Codex is consuming the same global configuration as Claude Code and to produce a manifest-driven drift report before any repair.

## What this skill checks

- Shared rules via `~/.claude/shared-knowledge/AGENTS.md`
- Codex global instruction entrypoint: `~/.codex/AGENTS.md`
- Skill sync manifest: `~/.claude/shared-knowledge/sync-manifest.json`
- Custom Claude skills under `~/.claude/skills/`
- Corresponding Codex-visible skill links under `~/.codex/skills/`
- Commands listed in manifest `synced_commands`

## Workflow

1. Read the current state before changing anything.
2. If the user changed a shared governance asset inside a project directory, first decide whether it should be promoted to `~/.claude/`.
3. Promote project-local copies into the global Claude source of truth unless they are explicitly project-only.
4. Run the report script:

```bash
bash ~/.claude/skills/codex-cc-sync-check/scripts/check_and_align.sh
```

5. Read the JSON report and summarize:
   - `ok`
   - `drift_items[]`
   - `dangling_links[]`
   - whether command differences are covered by `commands_divergence_policy`
6. Only if the user asked for repair, use the report as the diff basis and then adjust the link layout manually.

## Report rules

- Read `excluded_skills` and `synced_skills` from manifest as the expected skill scope.
- List both `~/.claude/skills/` and `~/.codex/skills/`, exclude `excluded_skills`, and diff against manifest.
- Detect dangling symlinks under `~/.codex/skills/` with `test -L` and `! test -e`.
- Only check commands listed in manifest `synced_commands`.
- Treat command differences outside `synced_commands` as legal when they match `commands_divergence_policy`.
- Never auto-repair during the report step.

## Expected output

Report JSON with:

- `ok`
- `drift_items[]`
- `dangling_links[]`

## Notes

- This skill is specifically for global Codex/Claude alignment, not project-local repository setup.
- Project-local governance edits are temporary staging at most; unless clearly marked project-only, the durable source of truth should live under `~/.claude/`.
- `synced_commands` is intentionally narrow. Most Codex commands are skill proxies; most Claude commands are CC-only control surfaces.
- A running Codex session does not hot-reload the skill list in its prompt. After repairing links, start a new Codex session to observe newly added skills in the prompt context.
