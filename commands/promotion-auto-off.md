/promotion-auto-off

关闭 Promotion Loop 自动模式，切回手动模式。

推荐：优先使用统一入口 `/promotion-mode off`。

执行要求：
1. 运行 `python3 "$HOME/.claude/hooks/promotion-mode.py" disable`
2. 确认返回 `autoBackgroundEnabled: false`
3. 说明此后 promotion 不会自动后台执行，需手动运行 `/promote-notes`
