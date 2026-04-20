/promotion-mode [on|off|status]

统一管理 Promotion Loop 模式。

参数：
- `on`：打开自动后台模式
- `off`：关闭自动后台模式，切回手动
- `status`：查看当前模式

执行要求：
1. `on` → `python3 "$HOME/.claude/scripts/promotion-mode.py" enable`
2. `off` → `python3 "$HOME/.claude/scripts/promotion-mode.py" disable`
3. `status` → `python3 "$HOME/.claude/scripts/promotion-mode.py" status`
4. 返回当前模式，并给出下一步动作：
   - 自动模式：继续正常工作，后台会自动处理 promotion
   - 手动模式：如需继续晋升，运行 `/promote-notes`

兼容别名：
- `/promotion-auto-on` = `/promotion-mode on`
- `/promotion-auto-off` = `/promotion-mode off`
- `/promotion-auto-status` = `/promotion-mode status`
