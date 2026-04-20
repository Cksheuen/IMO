/concept-flow-mode [on|off|status]

统一管理 `agent-concept-flow` 的注入开关。

参数：
- `on`：打开 concept flow 注入
- `off`：关闭 concept flow 注入，以节省 token
- `status`：查看当前状态

执行逻辑：

```bash
case "$ARGUMENTS" in
  on) python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" enable ;;
  off) python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" disable ;;
  status|"") python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status ;;
  *) echo "用法：/concept-flow-mode [on|off|status]" ;;
esac
```

执行要求：
1. `on` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" enable`
2. `off` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" disable`
3. `status` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status`
4. 返回当前状态，并给出下一步动作：
   - 已开启：继续正常使用；不需要概念讲解时运行 `/concept-flow-off`
   - 已关闭：当前处于节省 token 的 opt-out；需要恢复时运行 `/concept-flow-on`

兼容别名：
- `/concept-flow-on` = `/concept-flow-mode on`
- `/concept-flow-off` = `/concept-flow-mode off`
- `/concept-flow-status` = `/concept-flow-mode status`
