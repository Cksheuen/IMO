# Task-Centric Workflow

> 来源：[Trellis](https://github.com/mindfold-ai/Trellis) | 吸收时间：2026-03-25

## 触发条件

当出现以下任一情况时，应用此规范：

- 需要创建或管理 task 目录
- 讨论任务工作流、PRD 编写
- 涉及 `tasks/` 目录结构
- 关键词：task 目录、任务管理、tasks/、任务工作流、prd、status.md、context.md

## 核心原则

**任务驱动，上下文隔离**

每个任务独立目录，包含完整的上下文（PRD、实现状态、评审标准），使 AI 能准确理解工作目标。

`tasks/` 的标准位置是项目级目录：`<project>/.claude/tasks/`。

如果当前项目根目录本身就是 `.claude/`（例如本仓库），那么任务目录会自然落在仓库根下的 `tasks/`。

## 目录结构

```text
<project>/.claude/tasks/
├── 2026-03-31-feature-auth/
│   ├── prd.md        # 需求 + Acceptance Criteria
│   ├── context.md    # 相关文件、依赖
│   └── status.md     # 进度、blockers、next steps
└── 2026-03-31-feature-payment/
    └── ...
```

## 命名规范

任务目录名使用 `YYYY-MM-DD-slug`，其中 `slug` 必须直接表达任务目标，风格尽量接近 Trellis 的 `feature-auth` 这种语义化命名。

- 优先使用任务目标，例如 `2026-03-31-feature-auth`
- 评估/调研类任务也保持语义化，例如 `2026-03-31-skill-eval-iteration-2`
- 若任务尚未成型、暂时没有稳定语义，才允许使用 `YYYY-MM-DD-draft-task-<shortid>` 兜底
- 禁止直接使用纯 UUID 作为目录名，否则目录扫描时不可读、不可检索、不可恢复

## 关键实践

1. **PRD 明确验收标准**：Acceptance Criteria 作为评审依据
2. **status.md 记录进度**：便于会话恢复
3. **context.md 隔离上下文**：每个任务有独立的相关文件列表
4. **目录名可读**：扫描 `tasks/` 时应能直接看出任务主题，而不是再打开文件反查 UUID

## 文件规范

### `prd.md`

写什么：

- 任务目标与范围
- 明确的 Acceptance Criteria
- 非目标与边界
- 交付物定义

不写什么：

- 高频变化的当前进度
- 临时 blocker
- 长期复用的方法论或复盘

### `context.md`

写什么：

- 相关文件路径
- 依赖、接口、外部约束
- 当前任务需要的背景事实
- 需要特别注意的风险点

不写什么：

- 任务过程日志
- 与当前任务无关的广泛背景
- 已经沉淀为长期知识的通用结论

### `status.md`

写什么：

- 当前进度
- blocker / 风险
- next step
- 指向测试结果、PRD、notes 的链接或摘要

不写什么：

- 大段调研正文
- 长期有效的经验总结
- 与执行无关的解释性长文

### `feature-list.json`

写什么：

- 结构化 feature / subtask 状态
- 验证结果
- 尝试次数与失败备注

不写什么：

- 完整调研结论
- 跨任务 lesson
- 设计方案的全文说明

### 编号子任务 JSON（如 `1.json`）

如果保留，仅用于轻量子任务清单：

- `subject`
- `description`
- `status`
- 依赖关系

禁止把编号 JSON 当成长期知识正文或完整复盘文档。

## 与 `notes/` 的分工

- `tasks/`：项目级目录，服务当前任务闭环
- `notes/`：用户级全局目录 `~/.claude/notes/`，沉淀跨任务复用知识
- 当一段内容既需要当前执行、又值得长期保留时，`tasks/` 只保留摘要和指针，完整正文写入 `notes/`

详见 [[task-notes-boundary]]。

## 与 CLAUDE.md 的关系

CLAUDE.md Plan 阶段已整合此模式：每个任务独立规划，状态可追踪。

## 相关规则

- [[context-injection]] - 上下文注入
- [[git-worktree-parallelism]] - 并行任务隔离
- [[living-spec]] - 双向同步的活 spec（需求模糊时适用）
