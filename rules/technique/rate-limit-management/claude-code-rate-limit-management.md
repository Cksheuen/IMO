# Claude Code Rate Limit 自动管理

> 来源：brainstorm 调研 + 实现 | 吸收时间：2026-03-26

## 核心洞察

Claude Max 订阅有 5h 滚动窗口 + 7 天周限额的双层限制。通过 statusline `rate_limits` 数据 + `StopFailure` hook 组合，可实现自动暂停与恢复。

## 触发条件

- 长时间运行任务（如 loop、Agent Teams）
- 5h 窗口用量接近上限
- 需要无人值守的任务执行

## 架构

```
StatusLine (每 tick)              StopFailure Hook (rate limit 停止时)
    │                                      │
    ▼                                      ▼
rate-limit-monitor.sh              on-rate-limit-stop.sh
    │                                      │
    ├─ 写 rate-limit-state.json            ├─ 写 suspended-task.json
    └─ ≥95% 桌面通知                       ├─ 读 resets_at 时间
                                           └─ nohup sleep → resume-task.sh
                                                              │
                                                              ├─ 检查 rate limit 已重置
                                                              ├─ 打开 Terminal 恢复会话
                                                              └─ claude --resume $SESSION_ID
```

## 关键数据源

### statusline rate_limits (v2.1.80+)

```json
{
  "rate_limits": {
    "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },
    "seven_day": { "used_percentage": 41.2, "resets_at": 1738857600 }
  }
}
```

### StopFailure hook stdin

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/project/dir",
  "error": "rate_limit",
  "error_details": "429 Too Many Requests"
}
```

## 文件位置

所有文件位于 `~/.claude/rules/technique/rate-limit-management/` 下：

```
rate-limit-management/
├── claude-code-rate-limit-management.md   # 本文档
└── scripts/
    ├── statusline-wrapper.sh              # statusline 包装器
    ├── rate-limit-monitor.sh              # 解析 rate_limits，写状态文件
    ├── on-rate-limit-stop.sh              # StopFailure hook
    └── resume-task.sh                     # 定时恢复脚本
```

运行时产生的状态文件：

| 文件 | 作用 |
|------|------|
| `~/.claude/rate-limit-state.json` | 当前 rate limit 状态 |
| `~/.claude/suspended-task.json` | 挂起的任务上下文 |
| `~/.claude/rate-limit.log` | 操作日志 |

## 配置 (settings.json)

```json
{
  "hooks": {
    "StopFailure": [{
      "type": "command",
      "command": "bash ~/.claude/rules/technique/rate-limit-management/scripts/on-rate-limit-stop.sh"
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/rules/technique/rate-limit-management/scripts/statusline-wrapper.sh"
  },
  "permissions": {
    "allow": [
      "Bash(bash ~/.claude/rules/technique/rate-limit-management/scripts/*)"
    ]
  }
}
```

## 会话恢复方式

| 方式 | 命令 | 适用场景 |
|------|------|----------|
| 精确恢复 | `claude --resume $SESSION_ID` | 自动恢复（推荐） |
| 继续上次 | `claude -c` | 手动恢复 |
| 带提示恢复 | `claude --resume $ID -p "继续"` | 脚本化恢复 |

## 已知限制

- Hooks 不直接接收 `rate_limits` 数据（[Feature #36056](https://github.com/anthropics/claude-code/issues/36056)）
- 无法从外部"优雅暂停"会话，只能在停止后恢复
- `resets_at` 可能不精确，需要 buffer + retry 机制

## 相关规范

- [[long-running-agent-techniques]] - 长时 Agent 的 Handoff 机制
- [[proactive-delegation]] - 主动委派避免上下文膨胀

## 参考

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Statusline Docs](https://code.claude.com/docs/en/statusline)
- [autoclaude](https://github.com/henryaj/autoclaude)
- [claude-auto-resume](https://github.com/terryso/claude-auto-resume)
