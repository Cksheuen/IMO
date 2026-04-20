/concept-flow-status [global]

快捷入口。

执行：
```bash
if [ "$ARGUMENTS" = "global" ]; then
  python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status --scope global
else
  python3 "/Users/bytedance/.claude/hooks/concept-flow-mode.py" status
fi
```

默认 scope=`project`；追加 `global` 等价于 `/concept-flow-mode status global`。
