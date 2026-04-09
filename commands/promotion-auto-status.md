/promotion-auto-status

查看 Promotion Loop 当前模式。

推荐：优先使用统一入口 `/promotion-mode status`。

执行要求：
1. 运行 `python3 "$HOME/.claude/hooks/promotion-mode.py" status`
2. 返回当前是否开启自动后台执行
3. 若当前为手动模式，提示使用 `/promotion-auto-on`
4. 若当前为自动模式，提示使用 `/promotion-auto-off`
