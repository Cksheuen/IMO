---
name: concept-flow-mode
description: Toggle agent-concept-flow rule injection to save tokens. Use when the user wants to turn concept-flow guidance on or off, or check whether the rule is currently enabled.
description_zh: "用于管理 agent-concept-flow rule 的注入开关。默认 enabled=true；当用户不需要教学型概念流输出、想节省 token，或想查看当前状态时使用。"
---

# Concept Flow Mode

当用户想管理 `agent-concept-flow` 的注入状态时使用此 skill。

- 默认 `enabled=true`
- 默认 scope=`project`；若仓库根目录本身就是 `.claude/`，状态文件落在 `<repo-root>/concept-flow-config.json`，否则落在 `<repo-root>/.claude/concept-flow-config.json`
- 显式追加 `global` 时，改写全局 fallback：`~/.claude/concept-flow-config.json`
- `rules-inject` 读取优先级：`project -> global -> default(on)`
- `/concept-flow-off` 是节省 token 的显式 opt-out；未明确关闭时默认继续注入 concept flow rule

## Command Mapping

- `/concept-flow-mode on` -> `python3 "$HOME/.claude/hooks/concept-flow-mode.py" enable`
- `/concept-flow-mode on global` -> `python3 "$HOME/.claude/hooks/concept-flow-mode.py" enable --scope global`
- `/concept-flow-mode off` -> `python3 "$HOME/.claude/hooks/concept-flow-mode.py" disable`
- `/concept-flow-mode off global` -> `python3 "$HOME/.claude/hooks/concept-flow-mode.py" disable --scope global`
- `/concept-flow-mode status` -> `python3 "$HOME/.claude/hooks/concept-flow-mode.py" status`
- `/concept-flow-mode status global` -> `python3 "$HOME/.claude/hooks/concept-flow-mode.py" status --scope global`

## Response Requirements

执行后返回：

1. 当前 `enabled` 状态
2. 当前命中的 `scope`（`project` / `global` / `default`）
3. 配置文件路径与项目根（如果有）
4. 最近修改时间（如果有）
5. 下一步建议：
   - 若为 `true`，继续正常使用；不想要概念讲解时运行 `/concept-flow-off`
   - 若为 `false`，说明当前处于节省 token 的 opt-out；需要恢复时运行 `/concept-flow-on`

## Notes

- 此 skill 只暴露 concept flow 开关入口，不创建或修改 rule 正文。
- `off` 只是不注入 `agent-concept-flow`，不影响其他 rule。
- project scope 找不到 repo-root 时，hook 会回退到 global scope 并给出 warning。
