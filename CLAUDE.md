# CLAUDE.md

## 核心原则

- **简洁优先**：每次只改完成目标所需的最小范围
- **根因导向**：拒绝临时修补，优先修正真正的设计或流程问题
- **最小影响**：不顺手扩范围，不混入无关清理

## 语言偏好

- 与用户的交流默认使用中文：包括进度更新、问题确认、结果说明、错误解释、review 结论
- 持久化内容默认使用中文：`skills/`、`rules/`、`notes/`、`tasks/`
- 代码、注释、变量名、API 名称保持英文
- 仅在以下情况切换或夹带英文：用户明确要求、引用原始报错/协议字段/命令/代码、或英文更能避免歧义

## 默认工作流

`Plan -> Execute -> Verify -> Learn`

- `Plan`
  - 非平凡任务先规划，再动手
  - 优先使用 `tasks/` 记录当前任务事实
  - 当前仓库位于 `~/.claude/`，因此根目录 `tasks/` 只属于这个仓库项目
- `Execute`
  - 先锁定改动边界，再开始修改
  - 子任务可独立时优先委派或并行
  - 用户已确认方向后，默认沿当前路径执行到闭环
- `Verify`
  - 未证明有效，不标记完成
  - 结论必须附带文件路径、命令或日志证据
- `Learn`
  - 纠正、调研、设计结论先判断应写 `rules/`、`skills/`、`notes/` 还是 `tasks/`

## 高优先级边界

- 当前任务事实写 `tasks/`
- 跨任务复用结论写 `notes/`
- 稳定事实快照写 `memory/declarative/`
- 历史过程检索走 `recall/`
- `hooks/` 只放事件脚本；未挂到 `settings.json` 或项目级 `.claude/settings.json` 前，不算已接通运行链

## 必查规则入口

- 上下文注入：`rules/core/context-injection.md`
- 任务工作流：`rules/core/task-centric-workflow.md`
- task / notes 边界：`rules/core/task-notes-boundary.md`
- 改动边界守卫：`rules/pattern/change-scope-guard.md`
- 变更影响审查：`rules/pattern/change-impact-review.md`
- 废弃方案清理：`rules/pattern/abandoned-solution-cleanup.md`
- 闭环学习边界：`rules/pattern/closed-learning-loop.md`
- LangChain 迁移 runtime 依赖：`rules/tool/langchain-runtime-dependencies.md`

## Notes 读取协议

- 被纠正、被质疑、被要求复盘：读 `notes/lessons/`
- 做技术选型、brainstorm、方案探索：读 `notes/research/`
- 做目录、调用链、迁移与架构设计：读 `notes/design/`
- 普通实现任务不要默认全量读取 `notes/`

## 自动化与治理

- 需要并行拆分时使用 `orchestrate`
- 需要索引路径与代码地图时使用 `locate`
- 写新规范时遵守 `rules/core/llm-friendly-format.md`
- 若声称某条 hook/loop “已落地”，必须能指出挂载位置、触发事件、消费方和验证方法
