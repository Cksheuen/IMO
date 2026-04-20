/concept-flow-mode [on|off|status] [global]

统一管理 `agent-concept-flow` 的注入开关。

参数：
- `on`：打开 concept flow 注入
- `off`：关闭 concept flow 注入，以节省 token
- `status`：查看当前状态
- `global`：可选第二参数；显式切换到全局 scope。默认 scope=`project`

执行逻辑：

```bash
set -- $ARGUMENTS
action="${1:-status}"
scope_arg=""

if [ "${2:-}" = "global" ]; then
  scope_arg="--scope global"
fi

case "$action" in
  on) python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" enable $scope_arg ;;
  off) python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" disable $scope_arg ;;
  status) python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status $scope_arg ;;
  *) echo "用法：/concept-flow-mode [on|off|status] [global]" ;;
esac
```

执行要求：
1. `on` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" enable`
2. `on global` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" enable --scope global`
3. `off` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" disable`
4. `off global` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" disable --scope global`
5. `status` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status`
6. `status global` -> `python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status --scope global`
7. 返回当前状态，并给出下一步动作：
   - 已开启：继续正常使用；不需要概念讲解时运行 `/concept-flow-off`
   - 已关闭：当前处于节省 token 的 opt-out；需要恢复时运行 `/concept-flow-on`

兼容别名：
- `/concept-flow-on` = `/concept-flow-mode on`
- `/concept-flow-off` = `/concept-flow-mode off`
- `/concept-flow-status` = `/concept-flow-mode status`
