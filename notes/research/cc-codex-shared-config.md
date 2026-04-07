---
status: implemented
created: 2026-04-02
---

# CC ↔ Codex 双向共享知识系统

## 问题

Codex CLI 通过 codex-cc-plugin 启动时是"白板 agent"——不继承 CC 的 rules/skills/lessons，也无法将执行经验回流。

## 方案

建立双向知识桥接层：

```
CC rules → compile-rules.py → AGENTS.md → Codex 自动读取
Codex output → codex-feedback.jsonl → /codex-feedback-review → process-codex-feedback.py → CC lessons
```

## 关键发现

1. **Codex CLI 原生支持 AGENTS.md**（等价于 CC 的 CLAUDE.md），从 git root 到 cwd 层级发现，上限 32KB
2. **codex-cc-plugin 的 prompt 是直接透传的**（`readTaskPrompt` → `executeTaskRun` → `runAppServerTurn`），无预处理
3. **plugin 的 `state.mjs` config** 已有 extensible key-value store（`setConfig/getConfig`）

## 实现文件

| 文件 | 用途 |
|------|------|
| `hooks/codex-sync/compile-rules.py` | CC rules → 精简 AGENTS.md 编译器（按优先级 P0-P4 裁剪至 28KB） |
| `hooks/codex-sync/sync-to-codex.sh` | 同步脚本，哈希对比避免无变化写入 |
| `hooks/codex-sync/process-codex-feedback.py` | Codex 反馈分析器（hotspot/failure/theme 模式检测） |
| `shared-knowledge/sync-manifest.json` | 同步状态跟踪 |
| `shared-knowledge/codex-feedback.jsonl` | Codex 执行反馈日志 |

## 触发链路

- **SessionEnd hook** 仅触发 `sync-to-codex.sh`（CC→Codex）与 consolidation；不再自动写 Codex feedback lessons
- **codex-companion.mjs** 每次任务/review 完成后追加反馈到 `codex-feedback.jsonl`
- **`/codex-feedback-review`** 在需要时显式消费增量 feedback，并调用 `process-codex-feedback.py` 写回 CC lessons
- **codex-rescue agent** 组装 prompt 时注入 `<project_rules>` block

## 参考

- [Custom instructions with AGENTS.md – Codex](https://developers.openai.com/codex/guides/agents-md)
- [Config basics – Codex](https://developers.openai.com/codex/config-basic)
