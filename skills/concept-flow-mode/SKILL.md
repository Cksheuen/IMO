---
name: concept-flow-mode
description: Toggle agent-concept-flow rule injection to save tokens. Use when the user wants to turn concept-flow guidance on or off, or check whether the rule is currently enabled.
description_zh: "用于管理 agent-concept-flow rule 的注入开关。默认 enabled=true；当用户不需要教学型概念流输出、想节省 token，或想查看当前状态时使用。"
---

# Concept Flow Mode

当用户想管理 `agent-concept-flow` 的注入状态时使用此 skill。

- 默认 `enabled=true`
- `/concept-flow-off` 是节省 token 的显式 opt-out
- 未明确关闭时，默认继续注入 concept flow rule

## Command Mapping

- `/concept-flow-mode on` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" enable`
- `/concept-flow-mode off` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" disable`
- `/concept-flow-mode status` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status`

## Response Requirements

执行后返回：

1. 当前 `enabled` 状态
2. 最近修改时间（如果有）
3. 下一步建议：
   - 若为 `true`，继续正常使用；不想要概念讲解时运行 `/concept-flow-off`
   - 若为 `false`，说明当前处于节省 token 的 opt-out；需要恢复时运行 `/concept-flow-on`

## Notes

- 此 skill 只暴露 concept flow 开关入口，不创建或修改 rule 正文。
- `off` 只是不注入 `agent-concept-flow`，不影响其他 rule。
