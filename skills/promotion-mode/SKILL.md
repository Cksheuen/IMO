---
name: promotion-mode
description: Manage Promotion Loop mode. Use when the user wants to turn automatic background promotion on or off, or check whether Promotion Loop is currently in auto or manual mode.
---

# Promotion Mode

Use this skill when the user asks to:

- turn Promotion Loop auto mode on
- turn Promotion Loop auto mode off
- check current Promotion Loop mode

## Command Mapping

- `/promotion-mode on` -> `python3 "$HOME/.claude/hooks/promotion-mode.py" enable`
- `/promotion-mode off` -> `python3 "$HOME/.claude/hooks/promotion-mode.py" disable`
- `/promotion-mode status` -> `python3 "$HOME/.claude/hooks/promotion-mode.py" status`

## Response Requirements

After running the command:

1. Return the current `autoBackgroundEnabled` value.
2. State the next useful action:
   - if `true`, promotion will continue in background automatically
   - if `false`, the user should run `/promote-notes` manually when needed

## Notes

- This skill exists so Codex can expose `/promotion-mode` through the normal skill sync path.
- The runtime config is stored in the current repository root's `promotion-config.json`.
