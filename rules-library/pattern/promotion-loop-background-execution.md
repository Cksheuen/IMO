---
paths:
  - "hooks/**/*"
  - "**/promotion*"
---

# Promotion Loop 后台执行约束

> 来源：`notes/lessons/promotion-loop-background-execution.md` | 晋升时间：2026-04-03

## 触发条件

当 Stop hook 检测到 correction signals 或 promotion candidates 时。

## 核心原则

**必须后台执行，禁止打断主 agent。**

| 行为 | 允许 | 原因 |
|------|------|------|
| `exit 0` + `nohup claude ... &` | ✅ | 用户无感知 |
| `exit 2` + stderr 指令 | ❌ | 打断用户流程 |

## 执行规范

```bash
# ✅ 正确：后台执行
nohup claude --print -p "$PROMPT" > "$LOG_FILE" 2>&1 &
PID=$!
exit 0  # 允许主 agent 正常结束

# ❌ 错误：阻塞主 agent
cat >&2 <<EOF
[LESSON CAPTURE REQUIRED]
...指令...
EOF
exit 2  # 阻止停止
```

## 决策框架

```
Stop hook 检测到信号？
    │
    ├─ 有 → 写入 queue
    │       → nohup claude ... &（后台）
    │       → exit 0（允许停止）
    │
    └─ 无 → exit 0
```

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 向 stderr 输出指令要求主 agent 执行 | 后台静默执行 |
| 使用 `exit 2` 阻止停止 | 使用 `exit 0` 允许停止 |

## 参考

- Source Cases：`notes/lessons/promotion-loop-background-execution.md`
