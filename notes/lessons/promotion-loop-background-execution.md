---
name: promotion-loop-background-execution
description: Promotion Loop 必须在后台执行，不能打断主 agent
status: promoted
promoted_to: rules-library/pattern/promotion-loop-background-execution.md
promoted_at: 2026-04-03
type: lesson
created_at: 2026-04-03
---

# Promotion Loop 后台执行约束

## Trigger

当 Stop hook 检测到 correction signals 或 promotion candidates 时，触发 Promotion Loop。

## Decision

**必须使用 `nohup claude ... &` 在后台启动独立进程，然后 `exit 0`。**

| 行为 | 是否允许 | 原因 |
|------|----------|------|
| `exit 2` + 向 stderr 输出指令 | ❌ 禁止 | 打断用户流程 |
| `exit 0` + 后台启动 subagent | ✅ 正确 | 用户无感知 |

## 执行方式

```bash
# 正确：后台执行
nohup claude --print -p "$PROMPT" > "$LOG_FILE" 2>&1 &
PID=$!
exit 0  # 允许主 agent 正常结束

# 错误：阻塞主 agent
cat >&2 <<EOF
[LESSON CAPTURE REQUIRED]
...指令...
EOF
exit 2  # 阻止停止
```

## Why

用户明确纠正："教训晋升为规范，仍然没有强制约束在后台 subagent，当前它仍然会出现在主 agent 中，打断用户的开发。"

根因：`lesson-gate.sh` 使用 `exit 2` 阻止停止，并向主 agent 输出指令要求执行 subagent。这导致：
1. 用户看到 `[LESSON CAPTURE REQUIRED]` 提示
2. 主 agent 被迫执行 subagent 调用
3. 用户开发流程被打断

## How to Apply

所有 Stop hook 中的 Promotion Loop 相关逻辑：

1. **检测信号** → 写入 queue / state file
2. **启动后台进程** → `nohup claude --print ... &`
3. **记录日志** → `~/.claude/logs/lesson-capture/background-*.log`
4. **允许停止** → `exit 0`

**禁止**：向 stderr 输出任何要求主 agent 执行的指令。

## Source Cases

### 2026-04-03 Promotion Loop 打断用户

**问题**：
1. `lesson-gate.sh` 使用 `exit 2` 向主 agent 输出 `[LESSON CAPTURE REQUIRED]`
2. `promotion-gate.py` 使用 `decision: "block"` 输出 `[PROMOTION LOOP REQUIRED]`

**原因**：两个 hook 都使用阻断模式，要求主 agent 同步执行 subagent

**解决**：
- `lesson-gate.sh`: `nohup claude ... &` + `exit 0`
- `promotion-gate.py`: `subprocess.Popen(["nohup", "claude", ...])` + `sys.exit(0)`

**修复文件**：
- `hooks/lesson-capture/lesson-gate.sh`
- `hooks/promotion-gate.py`
- `skills/promote-notes/SKILL.md`
- `hooks/README.md`
