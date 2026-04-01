# tasks/

`tasks/` 是**当前项目的任务事实源**，服务单次任务的规划、执行、验证与恢复。

标准位置是 `<project>/.claude/tasks/`。

当前仓库默认通过 `hooks/scale-gate.sh` 在会话首次进入 `Edit/Write` 前自动 bootstrap 当前 task 目录，并预置 `prd.md`、`context.md`、`status.md`、`feature-list.json`。

当前仓库本身位于 `~/.claude/`，所以这里的 `tasks/` 只是这个仓库项目自己的任务目录；它不是其他项目共享的全局 task 池。

它回答的是：

- 这次任务要做什么
- 现在做到哪了
- 卡在哪里
- 下一步是什么
- 验收是否通过

## 推荐结构

```text
<project>/.claude/tasks/
└── 2026-03-31-feature-auth/
    ├── prd.md
    ├── context.md
    ├── status.md
    ├── feature-list.json
    └── 1.json
```

## 文件职责

### `prd.md`

- 写目标、范围、Acceptance Criteria、交付物
- 不写实时进度和过程日志

### `context.md`

- 写相关文件、依赖、外部约束、背景事实
- 不写与当前任务无关的泛化知识

### `status.md`

- 写当前进度、blocker、next step、关键证据链接
- 不写大段长期复盘或通用方法论

### `feature-list.json`

- 写结构化验证状态、attempt_count、passes、notes
- 不写完整调研正文或设计长文

### 编号子任务 JSON（如 `1.json`）

- 仅作为轻量子任务清单
- 建议只放 `subject`、`description`、`status`、依赖关系
- 不要把它当成长期知识文档

## 与 `notes/` 的区别

- `tasks/`：项目级目录，服务当前任务闭环
- `notes/`：用户级全局目录 `~/.claude/notes/`，沉淀跨任务可复用知识

如果一段内容既要支撑当前执行，又值得长期复用：

- `tasks/` 只保留摘要与指针
- 完整正文写入 `notes/`

详见：

- `rules/core/task-centric-workflow.md`
- `rules/core/task-notes-boundary.md`
