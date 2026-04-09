/promotion-auto-on

打开 Promotion Loop 自动模式。

推荐：优先使用统一入口 `/promotion-mode on`。

执行要求：
1. 运行 `python3 "$HOME/.claude/hooks/promotion-mode.py" enable`
2. 确认返回 `autoBackgroundEnabled: true`
3. 说明此后 `Stop` / `SubagentStop` 会在后台自动扫描并处理 promotion candidates
