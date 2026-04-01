# 改动边界守卫规范

> 层级: L2 | 项目: claude-config | 更新: 2026-04-01

## 概述

为 `~/.claude` 配置仓库新增一条“防止顺手改无关内容”的执行规范，要求 agent 在开工前锁定改动边界、执行中隔离附带发现、收尾前审查 diff。

## 技术栈

| 领域 | 技术 |
|------|------|
| 配置 | Markdown 规则文件 |
| 规范入口 | `CLAUDE.md` / `AGENTS.md` |
| 调研沉淀 | `notes/research/` |
| 长期索引 | `memory/` |

## 架构模式

`brainstorm` 调研记录先写入 `notes/research/2026-04-01-change-scope-guard.md`，收敛后晋升为 `rules/pattern/change-scope-guard.md`，再由 `CLAUDE.md` 和 `AGENTS.md` 的 Execute 段落提供高层入口。

## 接口定义

- 高层原则：只改完成当前目标所必需的文件和逻辑
- 扩范围条件：仅限 blocker、同根因链路、用户明确授权
- 收尾动作：diff 审查，去掉无关改动

## 源路径

- `/Users/bytedance/.claude/rules/pattern/change-scope-guard.md`
- `/Users/bytedance/.claude/notes/research/2026-04-01-change-scope-guard.md`
- `/Users/bytedance/.claude/CLAUDE.md`
- `/Users/bytedance/.claude/AGENTS.md`

## 关联索引

- `requirements-confirmation`
- `change-impact-review`
