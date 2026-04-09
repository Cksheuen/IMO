/promotion-mode [on|off|status]

统一管理 Promotion Loop 模式。

参数：
- `on`：打开自动后台模式
- `off`：关闭自动后台模式，切回手动
- `status`：查看当前模式

执行要求：
1. 当参数是 `on` 时，运行 `python3 "$HOME/.claude/hooks/promotion-mode.py" enable`
2. 当参数是 `off` 时，运行 `python3 "$HOME/.claude/hooks/promotion-mode.py" disable`
3. 当参数是 `status` 时，运行 `python3 "$HOME/.claude/hooks/promotion-mode.py" status`
4. 返回当前模式，并说明下一步可用动作：
   - 自动模式下可继续正常工作，promotion 会在后台自动处理
   - 手动模式下如需执行晋升，运行 `/promote-notes`

兼容别名：
- `/promotion-auto-on` = `/promotion-mode on`
- `/promotion-auto-off` = `/promotion-mode off`
- `/promotion-auto-status` = `/promotion-mode status`
