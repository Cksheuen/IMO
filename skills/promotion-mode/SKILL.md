---
name: promotion-mode
description: Manage Promotion Loop mode. Use when the user wants to turn automatic background promotion on or off, or check whether Promotion Loop is currently in auto or manual mode.
description_zh: "用于管理 Promotion Loop 的运行模式。当用户想开启或关闭后台自动晋升，或检查 Promotion Loop 当前处于自动模式还是手动模式时使用。"
---

# Promotion Mode

Use this skill when the user asks to:

- turn Promotion Loop auto mode on
- turn Promotion Loop auto mode off
- check current Promotion Loop mode

## Command Mapping

- `/promotion-mode on` -> `python3 "$HOME/.claude/scripts/promotion-mode.py" enable`
- `/promotion-mode off` -> `python3 "$HOME/.claude/scripts/promotion-mode.py" disable`
- `/promotion-mode status` -> `python3 "$HOME/.claude/scripts/promotion-mode.py" status`

## Response Requirements

After running the command:

1. Return the current `autoBackgroundEnabled` value.
2. State the next useful action:
   - if `true`, warn that background promotion-related flow is allowed and may increase token usage; suggest `/promotion-mode off` if the user does not explicitly want it
   - if `false`, the user should run `/promote-notes` manually when needed

## Notes

- This skill exists so Codex can expose `/promotion-mode` through the normal skill sync path.
- The runtime config is stored in the current repository root's `promotion-config.json`.
- Recommended default interpretation: manual `/promote-notes` is the safer primary path; auto mode is opt-in.
